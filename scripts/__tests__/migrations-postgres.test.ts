import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checksum, loadMigrations, runMigrations } from '../lib/migrations-core.mjs';
import { runLegacyBaseline } from '../lib/legacy-baseline-core.mjs';
import { migrateEnvironment } from '../lib/migrate-environment.mjs';

// Destructive tests: exclusively use a disposable TEST_DATABASE_URL, never DATABASE_URL.
const connectionString = process.env.TEST_DATABASE_URL;
describe.skipIf(!connectionString)('real PostgreSQL app migrations', () => {
  const client = new pg.Client({ connectionString });
  let migrations: Awaited<ReturnType<typeof loadMigrations>>;
  const run = () => runMigrations(client, { schema: 'dykil', migrations });
  beforeAll(async () => {
    await client.connect();
    migrations = await loadMigrations();
  });

  it('refuses a drifted ledger definition instead of trusting its rows', async () => {
    await run();
    await client.query('ALTER TABLE dykil._migrations ADD COLUMN extra text');
    await expect(run()).rejects.toThrow('ledger shape mismatch');
    expect((await client.query('SELECT count(*)::int AS n FROM dykil._migrations')).rows[0].n).toBe(1);
  });
  beforeEach(async () => {
    await client.query('DROP SCHEMA IF EXISTS dykil CASCADE');
  });
  afterAll(async () => {
    await client.end();
  });

  it('builds fresh, is idempotent, and the legacy verifier still only reads', async () => {
    expect(await run()).toEqual([{ name: migrations[0].name, adopted: false }]);
    expect(await run()).toEqual([]);
    expect((await runLegacyBaseline(client)).status).toBe('verified');
    expect((await client.query('SELECT count(*)::int AS n FROM dykil._migrations')).rows[0].n).toBe(1);
  });

  it('adopts matching populated tables without replaying DDL or modifying rows', async () => {
    await client.query('CREATE SCHEMA dykil');
    await client.query(migrations[0].sql);
    await client.query("INSERT INTO dykil.surveys(id,did,title,fields) VALUES ('survey', 'did:imajin:test', 'Original', '{}')");
    await client.query("INSERT INTO dykil.survey_responses(id,survey_id,answers,ticket_id) VALUES ('response', 'survey', '{\"answer\":42}', 'ticket')");
    const before = await client.query("SELECT c.oid, c.relfilenode FROM pg_class c WHERE c.oid = 'dykil.surveys'::regclass");
    const data = await client.query('SELECT row_to_json(s) AS value, xmin FROM dykil.surveys s');
    const statements: string[] = [];
    const observing = { query: (sql: string, params?: unknown[]) => {
      statements.push(sql);
      return client.query(sql, params);
    } };
    expect(await runMigrations(observing, { schema: 'dykil', migrations })).toEqual([{ name: migrations[0].name, adopted: true }]);
    expect(statements).not.toContain(migrations[0].sql);
    expect(statements.filter((sql) => /^(CREATE|INSERT)/.test(sql)).every((sql) => sql.includes('dykil._migrations'))).toBe(true);
    expect((await client.query("SELECT c.oid, c.relfilenode FROM pg_class c WHERE c.oid = 'dykil.surveys'::regclass")).rows).toEqual(before.rows);
    expect((await client.query('SELECT row_to_json(s) AS value, xmin FROM dykil.surveys s')).rows).toEqual(data.rows);
    expect((await client.query('SELECT answers FROM dykil.survey_responses')).rows).toEqual([{ answers: { answer: 42 } }]);
  });

  it.each([
    'ALTER TABLE dykil.surveys ADD COLUMN surprise text',
    'DROP INDEX dykil.idx_surveys_did',
    "ALTER TABLE dykil.surveys ALTER COLUMN status SET DEFAULT 'unknown'",
    'ALTER TABLE dykil.surveys ENABLE ROW LEVEL SECURITY',
    'CREATE VIEW dykil.surprise AS SELECT 1',
    "INSERT INTO dykil.surveys(id,did,title,fields) VALUES ('bad','did:test','bad','[]')",
    'ALTER TABLE dykil.surveys ADD CONSTRAINT extra CHECK (length(title)>0)',
    'CREATE UNIQUE INDEX extra ON dykil.surveys(handle)',
    "CREATE FUNCTION dykil.extra() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    "CREATE TYPE dykil.extra AS ENUM ('x')",
    'DROP INDEX dykil.idx_responses_created; CREATE INDEX idx_responses_created ON dykil.survey_responses(created_at) WHERE ticket_id IS NOT NULL',
  ])('rejects drift without creating a ledger: %s', async (sql) => {
    await client.query('CREATE SCHEMA dykil');
    await client.query(migrations[0].sql);
    await client.query(sql);
    await expect(run()).rejects.toThrow();
    expect((await client.query("SELECT to_regclass('dykil._migrations') AS ledger")).rows[0].ledger).toBeNull();
  });

  it('rejects a partial or empty existing schema instead of repairing it', async () => {
    await client.query('CREATE SCHEMA dykil');
    await expect(run()).rejects.toThrow('missing');
    expect((await client.query("SELECT to_regclass('dykil.surveys') AS table")).rows[0].table).toBeNull();
  });

  it('rejects a foreign key to a same-named table outside dykil', async () => {
    await client.query('CREATE SCHEMA dykil');
    await client.query(migrations[0].sql);
    await client.query('CREATE SCHEMA IF NOT EXISTS migration_foreign_fixture');
    await client.query('CREATE TABLE IF NOT EXISTS migration_foreign_fixture.surveys(id text PRIMARY KEY)');
    await client.query('ALTER TABLE dykil.survey_responses DROP CONSTRAINT survey_responses_survey_id_surveys_id_fk');
    await client.query('ALTER TABLE dykil.survey_responses ADD CONSTRAINT wrong FOREIGN KEY(survey_id) REFERENCES migration_foreign_fixture.surveys(id) ON DELETE CASCADE');
    await expect(run()).rejects.toThrow('foreign key');
    expect((await client.query("SELECT to_regclass('dykil._migrations') AS ledger")).rows[0].ledger).toBeNull();
  });

  it('rejects modified/deleted/unknown/out-of-order applied history', async () => {
    await run();
    await client.query("UPDATE dykil._migrations SET checksum = 'bad'");
    await expect(run()).rejects.toThrow('checksum mismatch');
    await client.query('UPDATE dykil._migrations SET checksum = $1', [migrations[0].checksum]);
    const changed = [{ ...migrations[0], sql: migrations[0].sql + '\n' }];
    changed[0].checksum = checksum(changed[0].sql);
    await expect(runMigrations(client, { schema: 'dykil', migrations: changed })).rejects.toThrow('checksum mismatch');
    await client.query("UPDATE dykil._migrations SET name = '0099_unknown.sql'");
    await expect(run()).rejects.toThrow('mismatch');
    await client.query('DELETE FROM dykil._migrations');
    await expect(run()).rejects.toThrow('empty');
  });

  it('rolls back the entire fresh schema and ledger if pending SQL fails', async () => {
    const sql = 'CREATE INDEX broken ON dykil.surveys USING btree (missing_column);';
    await expect(runMigrations(client, { schema: 'dykil', migrations: [...migrations, { name: '0002_broken.sql', sql, checksum: checksum(sql) }] })).rejects.toThrow();
    expect((await client.query("SELECT to_regnamespace('dykil') AS schema")).rows[0].schema).toBeNull();
  });

  it('applies pending SQL once and rejects missing local applied files', async () => {
    await run();
    const sql = 'ALTER TABLE dykil.surveys ADD COLUMN note text;';
    const next = [...migrations, { name: '0002_note.sql', sql, checksum: checksum(sql) }];
    expect(await runMigrations(client, { schema: 'dykil', migrations: next })).toEqual([{ name: '0002_note.sql', adopted: false }]);
    expect(await runMigrations(client, { schema: 'dykil', migrations: next })).toEqual([]);
    await expect(run()).rejects.toThrow('mismatch');
  });

  it('rolls back adoption ledger creation when a later pending file fails', async () => {
    await client.query('CREATE SCHEMA dykil');
    await client.query(migrations[0].sql);
    const sql = 'CREATE INDEX broken ON dykil.surveys USING btree (missing_column);';
    await expect(runMigrations(client, { schema: 'dykil', migrations: [...migrations, { name: '0002_broken.sql', sql, checksum: checksum(sql) }] })).rejects.toThrow();
    expect((await client.query("SELECT to_regclass('dykil._migrations') AS ledger")).rows[0].ledger).toBeNull();
    expect((await client.query("SELECT to_regclass('dykil.surveys') AS table")).rows[0].table).toBe('dykil.surveys');
  });

  it('serializes concurrent runners into one ledger entry', async () => {
    const second = new pg.Client({ connectionString });
    await second.connect();
    await second.query("SET default_transaction_isolation = 'repeatable read'");
    try {
      const results = await Promise.all([run(), runMigrations(second, { schema: 'dykil', migrations })]);
      expect(results.map((result) => result.length).sort()).toEqual([0, 1]);
    } finally {
      await second.end();
    }
  });

  it('runs the actual environment adapter with separate migration credentials', async () => {
    expect(await migrateEnvironment({ DATABASE_URL: connectionString, APP_DB_SCHEMA: 'dykil' })).toHaveLength(1);
  });

  it('leaves every other schema and shared ledger untouched', async () => {
    const before = await client.query("SELECT nspname, oid FROM pg_namespace WHERE nspname <> 'dykil' ORDER BY oid");
    await run();
    expect((await client.query("SELECT nspname, oid FROM pg_namespace WHERE nspname <> 'dykil' ORDER BY oid")).rows).toEqual(before.rows);
    expect((await client.query("SELECT to_regclass('public._migrations') AS ledger")).rows[0].ledger).toBeNull();
  });
});
