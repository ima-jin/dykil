/**
 * Read-only baseline of the LEGACY `dykil` Postgres schema (refs
 * ima-jin/imajin-ai#2520). Pure logic: takes anything with a `query(sql)`
 * method (a `pg` Client), so it is unit-testable without a database.
 *
 * Why read-only: dykil owns no database (Ryan's ruling, 2026-09-22, #1985->c).
 * The two legacy tables, `dykil.surveys` and `dykil.survey_responses`, were
 * created by the monorepo's shared root migrations and are NOT kernel-owned
 * tables, so no migration is carried into this repo (docs/MIGRATIONS.md). What
 * the operator needs before a cutover is proof that the live prod/dev schema
 * and data are exactly what `scripts/import-legacy.ts` was written against.
 * That is all this does:
 *
 *   - Idempotent by construction: it never writes, so running it again is a
 *     no-op. There is no tracking table to create — that would be an
 *     app-owned table, which the ruling forbids.
 *   - Refuses on mismatch: any difference in tables, columns, types,
 *     nullability, defaults, primary/foreign keys, required indexes, or in the
 *     data invariants the importer relies on throws BaselineMismatchError
 *     listing every problem.
 *   - Never drops, truncates, alters or inserts. Every statement is a SELECT,
 *     run inside a READ ONLY transaction (so Postgres itself rejects a write
 *     even if one were added by mistake). The test suite audits every
 *     statement issued.
 *   - Reports counts only — never row content, never connection details.
 */

export const LEGACY_SCHEMA = 'dykil';

export const SURVEY_STATUSES = ['draft', 'published', 'closed'];
export const SURVEY_TYPES = ['survey', 'pre-event', 'post-event', 'form'];

/** Columns exactly as the seed + 0008 migration created them (pg_catalog form). */
export const EXPECTED_TABLES = {
  surveys: {
    columns: {
      id: { type: 'text', notNull: true, default: null },
      did: { type: 'text', notNull: true, default: null },
      title: { type: 'text', notNull: true, default: null },
      description: { type: 'text', notNull: false, default: null },
      fields: { type: 'jsonb', notNull: true, default: null },
      settings: { type: 'jsonb', notNull: false, default: "'{}'::jsonb" },
      status: { type: 'text', notNull: true, default: "'draft'::text" },
      created_at: { type: 'timestamp with time zone', notNull: false, default: 'now()' },
      updated_at: { type: 'timestamp with time zone', notNull: false, default: 'now()' },
      handle: { type: 'text', notNull: false, default: null },
      type: { type: 'text', notNull: true, default: "'survey'::text" },
    },
    primaryKey: ['id'],
    foreignKeys: [],
    // Required by column list, in any name; partial indexes count.
    indexes: [['did'], ['handle'], ['status']],
  },
  survey_responses: {
    columns: {
      id: { type: 'text', notNull: true, default: null },
      survey_id: { type: 'text', notNull: true, default: null },
      respondent_did: { type: 'text', notNull: false, default: null },
      answers: { type: 'jsonb', notNull: true, default: null },
      created_at: { type: 'timestamp with time zone', notNull: false, default: 'now()' },
      ticket_id: { type: 'text', notNull: false, default: null },
    },
    primaryKey: ['id'],
    foreignKeys: [{ columns: ['survey_id'], refTable: 'surveys', refColumns: ['id'], onDelete: 'c' }],
    indexes: [['created_at'], ['respondent_did'], ['survey_id'], ['ticket_id']],
  },
};

export class BaselineMismatchError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(
      `Legacy ${LEGACY_SCHEMA} schema/data does not match what the importer expects (${problems.length} problem(s)):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'BaselineMismatchError';
    this.problems = problems;
  }
}

const QUERIES = {
  schemaExists: 'SELECT 1 AS present FROM pg_catalog.pg_namespace WHERE nspname = $1',
  tables: `SELECT c.relname AS table_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`,
  columns: `SELECT c.relname AS table_name, a.attname::text AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `SELECT rel.relname AS table_name, con.contype::text AS kind,
  ARRAY(
    SELECT att.attname::text
    FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    ORDER BY k.ord
  ) AS columns,
  ref.relname AS ref_table,
  ARRAY(
    SELECT att.attname::text
    FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_catalog.pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum
    ORDER BY k.ord
  ) AS ref_columns,
  con.confdeltype::text AS on_delete
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_class ref ON ref.oid = con.confrelid
WHERE n.nspname = $1 AND con.contype IN ('p', 'u', 'f')`,
  indexes: `SELECT t.relname AS table_name, i.relname AS index_name,
  ARRAY(
    SELECT att.attname::text
    FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_catalog.pg_attribute att ON att.attrelid = ix.indrelid AND att.attnum = k.attnum
    ORDER BY k.ord
  ) AS columns,
  ix.indisvalid AS is_valid
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = $1`,
  counts: `SELECT
  (SELECT count(*) FROM ${LEGACY_SCHEMA}.surveys)::int AS surveys,
  (SELECT count(*) FROM ${LEGACY_SCHEMA}.survey_responses)::int AS responses`,
  orphanResponses: `SELECT count(*)::int AS n
FROM ${LEGACY_SCHEMA}.survey_responses r
LEFT JOIN ${LEGACY_SCHEMA}.surveys s ON s.id = r.survey_id
WHERE s.id IS NULL`,
  unknownStatus: `SELECT count(*)::int AS n FROM ${LEGACY_SCHEMA}.surveys WHERE status <> ALL ($1::text[])`,
  unknownType: `SELECT count(*)::int AS n FROM ${LEGACY_SCHEMA}.surveys WHERE type <> ALL ($1::text[])`,
  badFields: `SELECT count(*)::int AS n FROM ${LEGACY_SCHEMA}.surveys WHERE jsonb_typeof(fields) <> 'object'`,
  badAnswers: `SELECT count(*)::int AS n FROM ${LEGACY_SCHEMA}.survey_responses WHERE jsonb_typeof(answers) <> 'object'`,
};

async function rows(client, name, params = []) {
  const result = await client.query(QUERIES[name], params);
  return result.rows;
}

const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const normalize = (expr) => (expr ?? '').replaceAll(/\s+/g, '');
const list = (values) => values.join(', ');

function compareColumns(table, expected, live, problems) {
  const liveByName = new Map(live.map((column) => [column.column_name, column]));
  for (const [name, want] of Object.entries(expected)) {
    const have = liveByName.get(name);
    if (have === undefined) {
      problems.push(`${table}.${name}: column is missing.`);
      continue;
    }
    if (have.data_type !== want.type) {
      problems.push(`${table}.${name}: type is ${have.data_type}, expected ${want.type}.`);
    }
    if (have.not_null !== want.notNull) {
      problems.push(`${table}.${name}: ${want.notNull ? 'must be NOT NULL' : 'must be nullable'}.`);
    }
    if (normalize(have.column_default) !== normalize(want.default)) {
      problems.push(`${table}.${name}: default is ${have.column_default ?? 'none'}, expected ${want.default ?? 'none'}.`);
    }
  }
  for (const name of liveByName.keys()) {
    if (!(name in expected)) {
      problems.push(`${table}.${name}: unexpected column (its data would not be imported).`);
    }
  }
}

function compareConstraints(table, expected, live, problems) {
  const primary = live.filter((c) => c.kind === 'p');
  if (primary.length !== 1 || !same(primary[0].columns, expected.primaryKey)) {
    problems.push(`${table}: primary key must be exactly (${list(expected.primaryKey)}).`);
  }
  const unique = live.filter((c) => c.kind === 'u');
  for (const constraint of unique) {
    problems.push(`${table}: unexpected unique constraint on (${list(constraint.columns)}).`);
  }
  const foreign = live.filter((c) => c.kind === 'f');
  for (const want of expected.foreignKeys) {
    const found = foreign.some(
      (c) =>
        same(c.columns, want.columns) &&
        c.ref_table === want.refTable &&
        same(c.ref_columns, want.refColumns) &&
        c.on_delete === want.onDelete,
    );
    if (!found) {
      problems.push(`${table}: missing foreign key (${list(want.columns)}) -> ${want.refTable}(${list(want.refColumns)}) ON DELETE CASCADE.`);
    }
  }
  if (foreign.length !== expected.foreignKeys.length) {
    problems.push(`${table}: expected ${expected.foreignKeys.length} foreign key(s), found ${foreign.length}.`);
  }
}

function compareIndexes(table, expected, live, problems) {
  for (const columns of expected) {
    if (!live.some((index) => index.is_valid && same(index.columns, columns))) {
      problems.push(`${table}: no valid index on (${list(columns)}).`);
    }
  }
}

function compareSchema({ tables, columns, constraints, indexes }) {
  const problems = [];
  const liveTables = new Set(tables.map((t) => t.table_name));
  for (const [name, spec] of Object.entries(EXPECTED_TABLES)) {
    if (!liveTables.has(name)) {
      problems.push(`${LEGACY_SCHEMA}.${name}: table is missing.`);
      continue;
    }
    const forTable = (all) => all.filter((row) => row.table_name === name);
    compareColumns(name, spec.columns, forTable(columns), problems);
    compareConstraints(name, spec, forTable(constraints), problems);
    compareIndexes(name, spec.indexes, forTable(indexes), problems);
  }
  for (const name of liveTables) {
    if (!(name in EXPECTED_TABLES)) {
      problems.push(`${LEGACY_SCHEMA}.${name}: unexpected table (its data would not be imported).`);
    }
  }
  return problems;
}

async function compareData(client) {
  const problems = [];
  const checks = [
    ['orphanResponses', [], 'survey_responses row(s) reference a survey that does not exist'],
    ['unknownStatus', [SURVEY_STATUSES], `survey(s) have a status outside ${list(SURVEY_STATUSES)}`],
    ['unknownType', [SURVEY_TYPES], `survey(s) have a type outside ${list(SURVEY_TYPES)}`],
    ['badFields', [], 'survey(s) have a `fields` value that is not a JSON object'],
    ['badAnswers', [], 'survey_responses row(s) have an `answers` value that is not a JSON object'],
  ];
  for (const [name, params, message] of checks) {
    const [{ n }] = await rows(client, name, params);
    if (n > 0) problems.push(`${n} ${message}.`);
  }
  return problems;
}

/**
 * Verifies the live legacy schema and data. Resolves with
 * `{ status: 'verified', surveys, responses }` or `{ status: 'fresh-database' }`
 * (no `dykil` schema at all — nothing to baseline); throws
 * BaselineMismatchError otherwise. Writes nothing.
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} client
 */
export async function runLegacyBaseline(client) {
  await client.query('BEGIN READ ONLY');
  try {
    if ((await rows(client, 'schemaExists', [LEGACY_SCHEMA])).length === 0) {
      return { status: 'fresh-database' };
    }
    const schemaProblems = compareSchema({
      tables: await rows(client, 'tables', [LEGACY_SCHEMA]),
      columns: await rows(client, 'columns', [LEGACY_SCHEMA]),
      constraints: await rows(client, 'constraints', [LEGACY_SCHEMA]),
      indexes: await rows(client, 'indexes', [LEGACY_SCHEMA]),
    });
    if (schemaProblems.length > 0) {
      // Data checks reference columns that may not exist; the schema comes first.
      throw new BaselineMismatchError(schemaProblems);
    }
    const dataProblems = await compareData(client);
    if (dataProblems.length > 0) {
      throw new BaselineMismatchError(dataProblems);
    }
    const [{ surveys, responses }] = await rows(client, 'counts');
    return { status: 'verified', surveys, responses };
  } finally {
    await client.query('ROLLBACK');
  }
}
