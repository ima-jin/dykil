import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyLegacyBaseline } from './legacy-baseline-core.mjs';

export const BASELINE = '0001_dykil_baseline.sql';
const DIRECTORY = join(process.cwd(), 'migrations');
export const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

export function validateSchema(schema) {
  if (schema !== 'dykil') throw new Error('APP_DB_SCHEMA must be exactly dykil.');
}

/**
 * Deliberately small plain-SQL dialect: additive tables, columns and indexes.
 * No procedural SQL, DML, quoted identifiers, arbitrary function calls, transaction
 * control or cross-schema references. Extend with reviewed tests, never bypass.
 * A database role restricted to dykil remains the deployment privilege boundary.
 */
export function validateSql(sql) {
  const text = sql.replaceAll(/'(?:[^']|'')*'|--[^\n]*/g, (token) => token.startsWith("'") ? "''" : '');
  if (/["$/\\]/.test(text) || /_migrations\b/i.test(text)) {
    throw new Error('Migration contains unsupported SQL or reserved ledger references.');
  }
  const statements = text.split(';').map((part) => part.trim()).filter(Boolean);
  if (statements.length === 0) throw new Error('Migration is empty.');
  for (const statement of statements) {
    validateStatement(statement);
  }
}

async function verifyMigrationBaseline(client) {
  await verifyLegacyBaseline(client);
  const { rows } = await client.query(`SELECT c.relname
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'dykil' AND (
  c.relkind NOT IN ('r', 'i') OR c.relrowsecurity OR c.relforcerowsecurity
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid AND k.contype NOT IN ('p', 'f'))
) UNION ALL
SELECT p.proname FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'dykil'
UNION ALL
SELECT t.typname FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'dykil' AND t.typtype IN ('d', 'e', 'r', 'm')`);
  if (rows.length > 0) throw new Error('Unexpected dykil catalog objects or constraints.');
  const { rows: indexes } = await client.query(`SELECT i.relname,
  pg_catalog.pg_get_expr(x.indpred, x.indrelid) AS predicate, a.amname,
  x.indisunique, x.indisprimary, x.indexprs IS NOT NULL AS expression,
  pg_catalog.pg_get_indexdef(x.indexrelid, 1, true) AS first_column
FROM pg_catalog.pg_index x
JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
JOIN pg_catalog.pg_am a ON a.oid = i.relam
WHERE n.nspname = 'dykil'`);
  for (const index of indexes) {
    const ticketPredicate = index.predicate === '(ticket_id IS NOT NULL)' && index.first_column === 'ticket_id';
    if (index.amname !== 'btree' || index.expression || (index.indisunique && !index.indisprimary)
      || (index.predicate !== null && !ticketPredicate)) {
      throw new Error('Unexpected dykil index definition.');
    }
  }
}

function validateStatement(statement) {
  const table = /^CREATE TABLE dykil\.([a-z][a-z0-9_]*)\s*\(/i.exec(statement);
  const index = /^CREATE INDEX [a-z][a-z0-9_]* ON dykil\.([a-z][a-z0-9_]*) USING btree\s*\(/i.exec(statement);
  const column = /^ALTER TABLE dykil\.([a-z][a-z0-9_]*) ADD COLUMN [a-z][a-z0-9_]* /i.exec(statement);
  if (column && statement.includes(',')) throw new Error('Only one ADD COLUMN per statement is supported.');
  if (!(table || index || column) || /[^a-z0-9_\s.,()':]/i.test(statement)) {
    throw new Error('Only additive dykil table, column and btree-index SQL is supported.');
  }
  const operations = statement.replaceAll(/\bON DELETE CASCADE\b/gi, '');
  if (/\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|COMMIT|ROLLBACK|BEGIN|GRANT|REVOKE|COPY|EXECUTE|DO|SET|TABLESPACE|INHERITS|LIKE|GENERATED|IDENTITY)\b/i.test(operations)) {
    throw new Error('Migration contains unsupported SQL operations.');
  }
  for (const match of statement.matchAll(/\b([a-z_][a-z0-9_]*)\s*\./gi)) {
    if (match[1].toLowerCase() !== 'dykil') throw new Error('Cross-schema migration SQL is forbidden.');
  }
  for (const match of statement.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const word = match[1].toLowerCase();
    const allowed = ['key', 'now', 'btree', table?.[1], index?.[1], column?.[1], 'surveys'];
    if (!allowed.includes(word)) throw new Error('Migration contains an unsupported function or expression.');
  }
  for (const match of statement.matchAll(/\bREFERENCES\s+(\S+)/gi)) {
    if (!match[1].startsWith('dykil.')) throw new Error('Foreign keys must reference dykil.');
  }
}

export async function loadMigrations(directory = DIRECTORY) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  if (names[0] !== BASELINE) throw new Error('The dykil baseline must be the first migration.');
  return Promise.all(names.map(async (name) => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Invalid migration filename.');
    const sql = await readFile(join(directory, name), 'utf8');
    validateSql(sql);
    return { name, sql, checksum: checksum(sql) };
  }));
}

function validateLedger(applied, migrations) {
  const files = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const [index, row] of applied.entries()) {
    if (files.get(row.name)?.checksum !== row.checksum || migrations[index]?.name !== row.name) {
      throw new Error(`Migration history/checksum mismatch: ${row.name}. Refusing to continue.`);
    }
  }
}

/** One transaction and transaction-scoped lock cover adoption plus all pending files. */
export async function runMigrations(client, { schema, migrations }) {
  validateSchema(schema);
  if (migrations[0]?.name !== BASELINE) throw new Error('Missing dykil baseline.');
  for (const migration of migrations) {
    validateSql(migration.sql);
    if (checksum(migration.sql) !== migration.checksum) throw new Error('Invalid migration checksum.');
  }
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_catalog.pg_advisory_xact_lock(1991, 1)");
    await client.query('SET LOCAL search_path = pg_catalog');
    const { rows: [state] } = await client.query("SELECT to_regnamespace('dykil') IS NOT NULL AS present, to_regclass('dykil._migrations') IS NOT NULL AS ledger");
    let applied = [];
    if (state.ledger) {
      ({ rows: applied } = await client.query('SELECT name, checksum FROM dykil._migrations ORDER BY name'));
      validateLedger(applied, migrations);
      if (applied.length === 0) throw new Error('Existing migration ledger is empty; refusing ambiguous adoption.');
      if (applied.length === 1) await verifyMigrationBaseline(client);
    } else if (state.present) {
      // Verify before ANY DDL. No baseline replay, table alteration or data write on adoption.
      await verifyMigrationBaseline(client);
    } else {
      await client.query('CREATE SCHEMA dykil');
    }
    if (!state.ledger) {
      await client.query('CREATE TABLE dykil._migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamp with time zone NOT NULL DEFAULT now())');
    }
    const completed = [];
    for (const migration of migrations.slice(applied.length)) {
      const adopt = state.present && !state.ledger && migration.name === BASELINE;
      if (!adopt) await client.query(migration.sql);
      await client.query('INSERT INTO dykil._migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      completed.push({ name: migration.name, adopted: adopt });
    }
    await client.query('COMMIT');
    return completed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
