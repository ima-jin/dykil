#!/usr/bin/env -S node --import tsx
import { pathToFileURL } from 'node:url';
import { legacyBoot } from './lib/legacy-vault-boot.mjs';

export async function main(argv) {
  // Retain --require compatibility; every invocation now fails closed.
  if (argv.some((arg) => arg !== '--require')) {
    console.error('Usage: legacy-baseline.mjs [--require]');
    return 2;
  }
  try {
    return await legacyBoot.start(async () => {
      const { runBaseline } = await import('./lib/legacy-baseline.mjs');
      return runBaseline();
    });
  } catch {
    console.error('Baseline failed: required vault configuration or legacy operation unavailable.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
