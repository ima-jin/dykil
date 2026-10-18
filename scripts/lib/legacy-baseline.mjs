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
import { BaselineMismatchError, runLegacyBaseline } from './legacy-baseline-core.mjs';
import { legacyBoot } from './legacy-vault-boot.mjs';

const { legacyDatabaseUrl } = legacyBoot.getConfig();

export async function runBaseline() {
  const client = new pg.Client({ connectionString: legacyDatabaseUrl });
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
    // Even error.message can contain credentials; use a fixed diagnostic.
    console.error('Baseline failed: legacy database operation unavailable.');
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

