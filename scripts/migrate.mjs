#!/usr/bin/env node
import { migrateEnvironment } from './lib/migrate-environment.mjs';

if (process.argv.length > 2) {
  console.error('Usage: APP_DB_SCHEMA=dykil node scripts/migrate.mjs (DATABASE_URL required)');
  process.exitCode = 2;
} else {
  try {
    const completed = await migrateEnvironment(process.env, { required: true });
    console.log(`dykil migrations complete: ${completed.length} applied/adopted.`);
  } catch {
    // Driver errors can include credentials or row content. Never print them.
    console.error('dykil migrations refused. Check schema, migration history and database permissions; nothing committed.');
    process.exitCode = 1;
  }
}
