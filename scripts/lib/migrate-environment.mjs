import pg from 'pg';
import { loadMigrations, runMigrations, validateSchema } from './migrations-core.mjs';

/** Never use the read-only LEGACY_DATABASE_URL as migration credentials. */
export async function migrateEnvironment(env, { required = false } = {}) {
  if (!env.DATABASE_URL) {
    if (required) throw new Error('DATABASE_URL is required for explicit migrations.');
    console.log('SKIPPED: DATABASE_URL absent; no app migrations run. LEGACY_DATABASE_URL remains read-only.');
    return [];
  }
  validateSchema(env.APP_DB_SCHEMA);
  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    return await runMigrations(client, { schema: env.APP_DB_SCHEMA, migrations });
  } catch {
    throw new Error('dykil migrations refused: verify schema, checksums and database permissions. Nothing committed.');
  } finally {
    await client.end();
  }
}
