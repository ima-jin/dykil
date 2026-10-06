#!/usr/bin/env node
/**
 * Idempotent, READ-ONLY baseline of the existing legacy `dykil` schema and
 * data (refs ima-jin/imajin-ai#2520). Safe to run on every deploy.
 *
 *   node --env-file=.env.local scripts/legacy-baseline.mjs [--require]
 *
 * Reads LEGACY_DATABASE_URL from the environment (use a read-only role) — it
 * never prints it. It issues SELECTs inside a READ ONLY transaction: nothing
 * is created, altered, dropped or written, so running it again is a no-op.
 * See docs/MIGRATIONS.md and scripts/lib/legacy-baseline-core.mjs.
 *
 *   --require   treat an unset LEGACY_DATABASE_URL as an error (default: skip,
 *               loudly — for environments whose legacy data is retired)
 *
 * Exit codes:
 *   0  verified, fresh database (no dykil schema), or skipped (no URL)
 *   1  REFUSED: schema or data does not match what the importer expects —
 *      nothing was changed; fix by hand, do not force
 *   2  usage / configuration / connection error
 */
import pg from 'pg';
import { BaselineMismatchError, runLegacyBaseline } from './lib/legacy-baseline-core.mjs';

async function main(argv) {
  const unknown = argv.filter((arg) => arg !== '--require');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}\nUsage: legacy-baseline.mjs [--require]`);
    return 2;
  }

  const connectionString = process.env.LEGACY_DATABASE_URL;
  if (!connectionString) {
    if (argv.includes('--require')) {
      console.error('LEGACY_DATABASE_URL is not set — run with `node --env-file=<env file> scripts/legacy-baseline.mjs`.');
      return 2;
    }
    console.log('SKIPPED: LEGACY_DATABASE_URL is not set, so the legacy schema was NOT verified. Use --require to make this an error.');
    return 0;
  }

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const result = await runLegacyBaseline(client);
    if (result.status === 'fresh-database') {
      console.log('Fresh database: there is no legacy dykil schema — nothing to baseline.');
    } else {
      console.log(
        `Verified: legacy dykil schema and data match what the importer expects (${result.surveys} surveys, ${result.responses} responses). Nothing was written.`,
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof BaselineMismatchError) {
      console.error(error.message);
      console.error('\nNothing was changed. Do NOT force this: reconcile the schema by hand, then re-run.');
      return 1;
    }
    // Message only: a driver error can carry connection details, so never dump the object.
    console.error(`Baseline failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

process.exitCode = await main(process.argv.slice(2));
