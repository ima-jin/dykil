import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Runs the import script the way the operator does (`pnpm import-legacy` ->
 * `tsx scripts/import-legacy.ts`), as a real subprocess. The other import
 * tests load the script through vitest/Vite, which resolves packages the way
 * the Next bundler does, so they could never catch the failure in
 * ima-jin/dykil#12: under Node's own loader, `@ima-jin/auth` (ESM-only, an
 * `import` condition and no `default`) is unresolvable from a CommonJS module
 * graph and the script died before doing anything.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const RESOLUTION_ERRORS = /ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_MODULE_NOT_FOUND|Cannot find module|ERR_REQUIRE_ESM/;

function runEntrypoint(env: Record<string, string>) {
  return spawnSync(TSX, ['scripts/import-legacy.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
  });
}

describe('scripts/import-legacy.ts entrypoint (tsx, as the operator runs it)', () => {
  it('is wired to the pnpm script the runbook uses', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['import-legacy']).toBe('tsx scripts/import-legacy.ts');
  });

  it('resolves the boot graph and fails closed without vault configuration', () => {
    const result = runEntrypoint({});

    expect(result.stderr).not.toMatch(RESOLUTION_ERRORS);
    expect(result.stderr).toContain('required vault configuration');
    expect(result.status).toBe(1);
  }, 60_000);

  it('does not use an inherited legacy env credential as a fallback', () => {
    const result = runEntrypoint({ LEGACY_DATABASE_URL: 'FAKE_ENV_VALUE_NOT_A_CONNECTION_STRING' });

    expect(result.stderr).not.toMatch(RESOLUTION_ERRORS);
    expect(result.stderr).toContain('Import failed:');
    expect(result.stderr).toContain('required vault configuration');
    expect(result.stderr).not.toContain('FAKE_ENV_VALUE_NOT_A_CONNECTION_STRING');
    expect(result.status).toBe(1);
  }, 60_000);
});
