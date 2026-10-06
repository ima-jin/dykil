import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BaselineMismatchError,
  EXPECTED_TABLES,
  LEGACY_SCHEMA,
  runLegacyBaseline,
} from '../lib/legacy-baseline-core.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

type Row = Record<string, unknown>;

interface FakeDb {
  schemaExists: boolean;
  tables: Row[];
  columns: Row[];
  constraints: Row[];
  indexes: Row[];
  data: Record<string, number>;
  counts: { surveys: number; responses: number };
}

/** A database that matches EXPECTED_TABLES exactly, with overridable pieces. */
function healthyDb(): FakeDb {
  const tables: Row[] = [];
  const columns: Row[] = [];
  const constraints: Row[] = [];
  const indexes: Row[] = [];
  for (const [table, spec] of Object.entries(EXPECTED_TABLES)) {
    tables.push({ table_name: table });
    for (const [name, col] of Object.entries(spec.columns)) {
      columns.push({
        table_name: table,
        column_name: name,
        data_type: col.type,
        not_null: col.notNull,
        column_default: col.default,
      });
    }
    constraints.push({ table_name: table, kind: 'p', columns: spec.primaryKey, ref_table: null, ref_columns: [], on_delete: 'a' });
    for (const fk of spec.foreignKeys) {
      constraints.push({
        table_name: table,
        kind: 'f',
        columns: fk.columns,
        ref_table: fk.refTable,
        ref_columns: fk.refColumns,
        on_delete: fk.onDelete,
      });
    }
    for (const cols of spec.indexes) {
      indexes.push({ table_name: table, index_name: `idx_${table}_${cols.join('_')}`, columns: cols, is_valid: true });
    }
  }
  return {
    schemaExists: true,
    tables,
    columns,
    constraints,
    indexes,
    data: { orphanResponses: 0, unknownStatus: 0, unknownType: 0, badFields: 0, badAnswers: 0 },
    counts: { surveys: 11, responses: 42 },
  };
}

function fakeClient(db: FakeDb) {
  const statements: string[] = [];
  const query = async (sql: string) => {
    statements.push(sql);
    const text = sql.trim();
    if (text === 'BEGIN READ ONLY' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('FROM pg_catalog.pg_namespace WHERE nspname')) return { rows: db.schemaExists ? [{ present: 1 }] : [] };
    if (text.includes("c.relkind IN ('r', 'p')") && !text.includes('attname')) return { rows: db.tables };
    if (text.includes('pg_get_expr')) return { rows: db.columns };
    if (text.includes('pg_catalog.pg_constraint')) return { rows: db.constraints };
    if (text.includes('pg_catalog.pg_index')) return { rows: db.indexes };
    if (text.includes('LEFT JOIN dykil.surveys')) return { rows: [{ n: db.data.orphanResponses }] };
    if (text.includes('status <> ALL')) return { rows: [{ n: db.data.unknownStatus }] };
    if (text.includes('type <> ALL')) return { rows: [{ n: db.data.unknownType }] };
    if (text.includes('jsonb_typeof(fields)')) return { rows: [{ n: db.data.badFields }] };
    if (text.includes('jsonb_typeof(answers)')) return { rows: [{ n: db.data.badAnswers }] };
    if (text.includes('count(*) FROM dykil.surveys')) return { rows: [db.counts] };
    throw new Error(`unexpected statement: ${text}`);
  };
  return { query, statements };
}

async function problemsFor(db: FakeDb): Promise<string[]> {
  try {
    await runLegacyBaseline(fakeClient(db));
  } catch (error) {
    expect(error).toBeInstanceOf(BaselineMismatchError);
    return (error as BaselineMismatchError).problems;
  }
  return [];
}

describe('runLegacyBaseline', () => {
  it('verifies a matching schema and reports counts only', async () => {
    const result = await runLegacyBaseline(fakeClient(healthyDb()));
    expect(result).toEqual({ status: 'verified', surveys: 11, responses: 42 });
  });

  it('is idempotent: running it twice gives the same answer and issues no writes', async () => {
    const db = healthyDb();
    const first = fakeClient(db);
    const second = fakeClient(db);
    expect(await runLegacyBaseline(first)).toEqual(await runLegacyBaseline(second));
    expect(first.statements).toEqual(second.statements);
  });

  it('only ever issues SELECTs inside a READ ONLY transaction that is rolled back', async () => {
    const client = fakeClient(healthyDb());
    await runLegacyBaseline(client);
    const [first, ...rest] = client.statements.map((s) => s.trim());
    expect(first).toBe('BEGIN READ ONLY');
    expect(rest.at(-1)).toBe('ROLLBACK');
    for (const statement of rest.slice(0, -1)) {
      expect(statement).toMatch(/^SELECT\b/);
    }
    const all = client.statements.join('\n');
    expect(all).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|COMMIT)\b/i);
  });

  it('rolls back and propagates when a query fails', async () => {
    const client = fakeClient(healthyDb());
    const failing = {
      query: async (sql: string) => {
        if (sql.includes('pg_catalog.pg_index')) throw new Error('boom');
        return client.query(sql);
      },
    };
    await expect(runLegacyBaseline(failing)).rejects.toThrow('boom');
    expect(client.statements.at(-1)?.trim()).toBe('ROLLBACK');
  });

  it('treats a database without the dykil schema as fresh (nothing to baseline)', async () => {
    const db = healthyDb();
    db.schemaExists = false;
    const client = fakeClient(db);
    expect(await runLegacyBaseline(client)).toEqual({ status: 'fresh-database' });
    expect(client.statements.at(-1)?.trim()).toBe('ROLLBACK');
  });

  it('refuses a missing table', async () => {
    const db = healthyDb();
    db.tables = db.tables.filter((t) => t.table_name !== 'survey_responses');
    db.columns = db.columns.filter((c) => c.table_name !== 'survey_responses');
    expect(await problemsFor(db)).toContain(`${LEGACY_SCHEMA}.survey_responses: table is missing.`);
  });

  it('refuses an unexpected table, because its data would not be imported', async () => {
    const db = healthyDb();
    db.tables.push({ table_name: 'surprise' });
    expect((await problemsFor(db)).join('\n')).toMatch(/dykil\.surprise: unexpected table/);
  });

  it('refuses missing, extra, retyped, nullability- and default-drifted columns', async () => {
    const db = healthyDb();
    db.columns = db.columns.filter((c) => !(c.table_name === 'surveys' && c.column_name === 'handle'));
    db.columns.push({ table_name: 'surveys', column_name: 'extra', data_type: 'text', not_null: false, column_default: null });
    for (const column of db.columns) {
      if (column.table_name === 'surveys' && column.column_name === 'title') column.data_type = 'character varying(255)';
      if (column.table_name === 'surveys' && column.column_name === 'did') column.not_null = false;
      if (column.table_name === 'surveys' && column.column_name === 'status') column.column_default = "'open'::text";
      if (column.table_name === 'survey_responses' && column.column_name === 'respondent_did') column.not_null = true;
    }
    const problems = (await problemsFor(db)).join('\n');
    expect(problems).toMatch(/surveys\.handle: column is missing/);
    expect(problems).toMatch(/surveys\.extra: unexpected column/);
    expect(problems).toMatch(/surveys\.title: type is character varying\(255\), expected text/);
    expect(problems).toMatch(/surveys\.did: must be NOT NULL/);
    expect(problems).toMatch(/surveys\.status: default is 'open'::text/);
    expect(problems).toMatch(/survey_responses\.respondent_did: must be nullable/);
  });

  it('ignores whitespace differences in defaults', async () => {
    const db = healthyDb();
    for (const column of db.columns) {
      if (column.column_name === 'settings') column.column_default = "'{}'::jsonb ";
    }
    expect(await problemsFor(db)).toEqual([]);
  });

  it('refuses a wrong primary key, a stray unique constraint and a wrong or missing foreign key', async () => {
    const db = healthyDb();
    db.constraints = db.constraints.filter((c) => !(c.table_name === 'surveys' && c.kind === 'p'));
    db.constraints.push({ table_name: 'surveys', kind: 'u', columns: ['handle'], ref_table: null, ref_columns: [], on_delete: 'a' });
    for (const constraint of db.constraints) {
      if (constraint.kind === 'f') constraint.on_delete = 'a';
    }
    const problems = (await problemsFor(db)).join('\n');
    expect(problems).toMatch(/surveys: primary key must be exactly \(id\)/);
    expect(problems).toMatch(/surveys: unexpected unique constraint on \(handle\)/);
    expect(problems).toMatch(/survey_responses: missing foreign key \(survey_id\) -> surveys\(id\) ON DELETE CASCADE/);

    const extraFk = healthyDb();
    extraFk.constraints.push({ table_name: 'surveys', kind: 'f', columns: ['did'], ref_table: 'x', ref_columns: ['id'], on_delete: 'a' });
    expect((await problemsFor(extraFk)).join('\n')).toMatch(/surveys: expected 0 foreign key\(s\), found 1/);
  });

  it('refuses a missing or invalid required index, but tolerates extra ones and any index name', async () => {
    const db = healthyDb();
    db.indexes = db.indexes.filter((i) => !(i.table_name === 'surveys' && (i.columns as string[])[0] === 'did'));
    for (const index of db.indexes) {
      if (index.table_name === 'survey_responses' && (index.columns as string[])[0] === 'ticket_id') index.is_valid = false;
    }
    const problems = (await problemsFor(db)).join('\n');
    expect(problems).toMatch(/surveys: no valid index on \(did\)/);
    expect(problems).toMatch(/survey_responses: no valid index on \(ticket_id\)/);

    const tolerant = healthyDb();
    tolerant.indexes.push({ table_name: 'surveys', index_name: 'anything', columns: ['did', 'status'], is_valid: true });
    expect(await problemsFor(tolerant)).toEqual([]);
  });

  it.each([
    ['orphanResponses', /3 survey_responses row\(s\) reference a survey that does not exist/],
    ['unknownStatus', /3 survey\(s\) have a status outside draft, published, closed/],
    ['unknownType', /3 survey\(s\) have a type outside survey, pre-event, post-event, form/],
    ['badFields', /3 survey\(s\) have a `fields` value that is not a JSON object/],
    ['badAnswers', /3 survey_responses row\(s\) have an `answers` value that is not a JSON object/],
  ])('refuses data that breaks the importer: %s', async (key, message) => {
    const db = healthyDb();
    db.data[key] = 3;
    expect((await problemsFor(db)).join('\n')).toMatch(message);
  });

  it('lists every problem in the error message', async () => {
    const db = healthyDb();
    db.tables.push({ table_name: 'surprise' });
    db.indexes = [];
    let message = '';
    try {
      await runLegacyBaseline(fakeClient(db));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/does not match what the importer expects \(\d+ problem\(s\)\)/);
    expect(message).toMatch(/unexpected table/);
    expect(message).toMatch(/no valid index/);
  });
});

describe('scripts/legacy-baseline.mjs', () => {
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [`${ROOT}scripts/legacy-baseline.mjs`, ...args], {
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });

  it('skips loudly (exit 0) without LEGACY_DATABASE_URL', () => {
    const result = cli([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SKIPPED/);
  });

  it('fails with --require and no LEGACY_DATABASE_URL', () => {
    const result = cli(['--require']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/LEGACY_DATABASE_URL is not set/);
  });

  it('exits 2 on an unknown argument', () => {
    expect(cli(['--force']).status).toBe(2);
  });

  it('exits 2 on a connection failure without echoing the connection string', () => {
    const result = cli([], { LEGACY_DATABASE_URL: 'postgres://user:supersecretvalue@127.0.0.1:1/db' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Baseline failed/);
    expect(result.stdout + result.stderr).not.toContain('supersecretvalue');
  });
});
