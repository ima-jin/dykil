import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BASELINE, checksum, loadMigrations, runMigrations, validateSchema, validateSql } from '../lib/migrations-core.mjs';
import { migrateEnvironment } from '../lib/migrate-environment.mjs';

describe('migration boundaries', () => {
  it.each([undefined, '', 'public', 'events', 'dykil;DROP SCHEMA public', 'DYKIL'])('rejects schema %s', (schema) => {
    expect(() => validateSchema(schema)).toThrow('APP_DB_SCHEMA');
  });

  it('accepts only the pinned schema and hashes exact bytes', () => {
    expect(() => validateSchema('dykil')).not.toThrow();
    expect(checksum('x')).toHaveLength(64);
    expect(checksum('x')).not.toBe(checksum('x\n'));
  });

  it('loads a sorted, validated SQL baseline', async () => {
    const files = await loadMigrations();
    expect(files.map((file: { name: string }) => file.name)).toEqual([BASELINE]);
    expect(files[0].checksum).toBe(checksum(files[0].sql));
  });

  it.each([
    '', '-- only a comment', 'BEGIN; CREATE TABLE dykil.a (id text);',
    'CREATE TABLE public.a (id text);', 'CREATE TABLE "dykil".a (id text);',
    'CREATE TABLE dykil.a (id text REFERENCES events.tickets(id));',
    'CREATE TABLE dykil.a (id text REFERENCES tickets(id));',
    'UPDATE events.tickets SET id = id;', 'INSERT INTO dykil.surveys VALUES (1);',
    'CREATE TABLE dykil.a (id text DEFAULT evil());',
    'CREATE TABLE dykil.a (id text); COMMIT;', 'DO $$ BEGIN END $$;',
    'CREATE TABLE dykil._migrations (id text);',
    'ALTER TABLE dykil.a ADD COLUMN x text, DROP COLUMN id;',
    "CREATE TABLE dykil.a (id text DEFAULT '--'); COMMIT;",
    'CREATE TABLE dykil.a (id text) TABLESPACE other;',
  ])('rejects unsupported or cross-owner SQL: %s', (sql) => {
    expect(() => validateSql(sql)).toThrow();
  });

  it('accepts additive app SQL and comment-like text inside literals', () => {
    expect(() => validateSql("ALTER TABLE dykil.surveys ADD COLUMN note text DEFAULT '--events.tickets;';")).not.toThrow();
  });

  it('refuses directories without a baseline and malformed filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dykil-migrations-'));
    await expect(loadMigrations(directory)).rejects.toThrow('first migration');
    await writeFile(join(directory, BASELINE), 'CREATE TABLE dykil.a (id text);');
    await writeFile(join(directory, 'oops.sql'), 'CREATE TABLE dykil.b (id text);');
    await expect(loadMigrations(directory)).rejects.toThrow('filename');
  });

  it('validates everything before starting a transaction', async () => {
    const client = { query: vi.fn() };
    await expect(runMigrations(client, { schema: 'dykil', migrations: [] })).rejects.toThrow('baseline');
    await expect(runMigrations(client, { schema: 'dykil', migrations: [{ name: BASELINE, sql: 'CREATE TABLE dykil.a (id text);', checksum: 'wrong' }] })).rejects.toThrow('checksum');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('rolls back query errors and never commits', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw new Error('database failure');
      return { rows: [] };
    }) };
    await expect(runMigrations(client, { schema: 'dykil', migrations: await loadMigrations() })).rejects.toThrow('database failure');
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT pg_catalog.pg_advisory_xact_lock(1991, 1)', 'ROLLBACK']);
  });
});

describe('migration environment and CLI', () => {
  it('skips at boot without migration credentials, even with a legacy URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await migrateEnvironment({ LEGACY_DATABASE_URL: 'unused-read-only-url' })).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SKIPPED'));
    log.mockRestore();
  });

  it('requires an explicit URL and schema for operator migrations', async () => {
    await expect(migrateEnvironment({}, { required: true })).rejects.toThrow('DATABASE_URL');
    await expect(migrateEnvironment({ DATABASE_URL: 'unused' })).rejects.toThrow('APP_DB_SCHEMA');
  });

  it('suppresses driver errors on connection failure', async () => {
    await expect(migrateEnvironment({ DATABASE_URL: 'postgresql://postgres@127.0.0.1:1/dykil_test', APP_DB_SCHEMA: 'dykil' }))
      .rejects.toThrow('Nothing committed');
  });

  const cli = (args: string[]) => spawnSync(process.execPath, ['scripts/migrate.mjs', ...args], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8',
  });
  it('explicit CLI fails rather than silently skipping and validates arguments', () => {
    expect(cli([]).status).toBe(1);
    expect(cli(['--force']).status).toBe(2);
    expect(cli([]).stderr).not.toMatch(/postgresql:|password/);
  });
});
