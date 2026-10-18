#!/usr/bin/env -S tsx
import { pathToFileURL } from 'node:url';
import { legacyBoot } from './lib/legacy-vault-boot.mjs';

/** Import the application/DB graph only after required vault configuration. */
export function runImport(argv: string[] = process.argv.slice(2)) {
  return legacyBoot.start(async () => {
    const worker = await import('./lib/import-legacy');
    return worker.runImport(argv);
  });
}

/* c8 ignore start -- real subprocess coverage in import-legacy-entrypoint.test.ts */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await runImport();
    console.log(process.argv.includes('--commit') ? 'Import complete:' : 'Dry run (pass --commit to write):', summary);
  } catch {
    console.error('Import failed: required vault configuration or legacy operation unavailable.');
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
