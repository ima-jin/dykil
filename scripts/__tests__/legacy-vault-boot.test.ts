import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBootstrapKeypair, writeKeystore, type AppSecretFetchPayload } from '@ima-jin/auth-client';
import { deriveXKeypairFromEd25519, sealSecret, wrapFieldKey } from '@ima-jin/vault-core';

const { client, clientConstructor } = vi.hoisted(() => {
  const client = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };
  return { client, clientConstructor: vi.fn(() => client) };
});
vi.mock('pg', () => ({ Client: clientConstructor, default: { Client: clientConstructor } }));

const FAKE_VALUE = 'FAKE_TEST_LEGACY_URL_NOT_A_CONNECTION_STRING';
const FAKE_ERROR = 'FAKE_PROVIDER_DETAIL_DO_NOT_ECHO';
let directory: string;

function sealedResponse(request: AppSecretFetchPayload, missing = false, value = FAKE_VALUE) {
  // Ephemeral test-only cryptographic material; no fixed keys or real credentials.
  const sender = deriveXKeypairFromEd25519(generateBootstrapKeypair().privateKey, 'test-envelope-sender');
  const fieldKey = randomBytes(32);
  return Response.json({
    version: 1,
    senderXPub: sender.publicKey,
    wrappedKey: wrapFieldKey(fieldKey, request.recipientXPub, sender.privateKey),
    sealed: sealSecret(JSON.stringify({
      domain: request.domain, appDid: request.appDid, nonce: request.nonce, keys: request.keys,
      values: missing ? {} : { LEGACY_DATABASE_URL: value },
      missing: missing ? ['LEGACY_DATABASE_URL'] : [],
    }), fieldKey),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'dykil-vault-test-'));
  const keystorePath = join(directory, 'bootstrap.json');
  writeKeystore(keystorePath, generateBootstrapKeypair());
  vi.stubEnv('IMAJIN_APP_KEYSTORE', keystorePath);
  vi.stubEnv('IMAJIN_APP_DID', 'did:imajin:test-app');
  vi.stubEnv('IMAJIN_KERNEL_URL', 'https://kernel.example');
  vi.stubEnv('LEGACY_DATABASE_URL', undefined);
  client.connect.mockResolvedValue(undefined);
  client.end.mockResolvedValue(undefined);
  client.query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

async function startCommand(command: string) {
  if (command === 'import') {
    const { runImport } = await import('../import-legacy');
    return runImport([]);
  }
  const { main } = await import('../legacy-baseline.mjs');
  return main([]);
}

describe('published SDK legacy credential boot', () => {
  it.each(['import', 'baseline'])('delays %s worker configuration and DB initialization until encrypted vault fetch completes', async (command) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let requested!: () => void;
    const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as AppSecretFetchPayload;
      expect(request).toMatchObject({ appDid: 'did:imajin:test-app', keys: ['LEGACY_DATABASE_URL'] });
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect(String(init.body)).not.toContain(FAKE_VALUE);
      requested();
      await pending;
      return sealedResponse(request);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { legacyBoot } = await import('../lib/legacy-vault-boot.mjs');
    expect(() => legacyBoot.getConfig()).toThrow('configuration unavailable');
    const started = startCommand(command);
    await requestStarted;
    expect(clientConstructor).not.toHaveBeenCalled();
    expect(() => legacyBoot.getConfig()).toThrow('configuration unavailable');
    release();
    await started;
    // Each real worker reads getConfig() at module evaluation, before constructing pg.
    expect(clientConstructor).toHaveBeenCalledOnce();
    expect(clientConstructor).toHaveBeenCalledWith({ connectionString: FAKE_VALUE });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(Object.isFrozen(legacyBoot.getConfig())).toBe(true);
    expect(process.env.LEGACY_DATABASE_URL).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'empty', 'refused', 'network', 'no-keystore'])('fails closed on %s without importing/initializing a database or falling back to env', async (mode) => {
    vi.stubEnv('LEGACY_DATABASE_URL', 'FAKE_ENV_FALLBACK_MUST_NOT_BE_USED');
    if (mode === 'no-keystore') vi.stubEnv('IMAJIN_APP_KEYSTORE', join(directory, 'absent'));
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      if (mode === 'network') throw new Error(FAKE_ERROR);
      if (mode === 'refused') return new Response(FAKE_ERROR, { status: 403 });
      return sealedResponse(JSON.parse(String(init.body)), mode === 'missing', mode === 'empty' ? '' : FAKE_VALUE);
    }));
    const { runImport } = await import('../import-legacy');
    await expect(runImport([])).rejects.toThrow(/^vault boot: startup failed$/);
    expect(clientConstructor).not.toHaveBeenCalled();
    const { legacyBoot } = await import('../lib/legacy-vault-boot.mjs');
    expect(() => legacyBoot.getConfig()).toThrow('configuration unavailable');
    await expect(runImport([])).rejects.toThrow('already started');
    expect(process.env.LEGACY_DATABASE_URL).toBe('FAKE_ENV_FALLBACK_MUST_NOT_BE_USED');
  });

  it('clears config and suppresses a DB failure and cause at the boot boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => sealedResponse(JSON.parse(String(init.body)))));
    client.connect.mockRejectedValue(new Error(FAKE_ERROR));
    const { runImport } = await import('../import-legacy');
    const error = await runImport([]).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('vault boot: startup failed');
    expect((error as Error).cause).toBeUndefined();
    const { legacyBoot } = await import('../lib/legacy-vault-boot.mjs');
    expect(() => legacyBoot.getConfig()).toThrow('configuration unavailable');
  });

  it('baseline prints a fixed diagnostic on vault refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(FAKE_ERROR)));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { main } = await import('../legacy-baseline.mjs');
    expect(await main([])).toBe(2);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('Baseline failed: required vault configuration or legacy operation unavailable.');
    expect(clientConstructor).not.toHaveBeenCalled();
  });

  it('baseline refuses invalid arguments before vault fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { main } = await import('../legacy-baseline.mjs');
    expect(await main(['--force'])).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientConstructor).not.toHaveBeenCalled();
  });

  it.each(['import', 'baseline'])('does not even evaluate the %s worker when vault fetch is refused', async (command) => {
    const evaluated = vi.fn(() => { throw new Error('FAKE_WORKER_MUST_NOT_LOAD'); });
    const workerPath = command === 'import' ? '../lib/import-legacy' : '../lib/legacy-baseline.mjs';
    vi.doMock(workerPath, evaluated);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(FAKE_ERROR)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      if (command === 'import') {
        await expect(startCommand(command)).rejects.toThrow('vault boot: startup failed');
      } else {
        expect(await startCommand(command)).toBe(2);
      }
      expect(evaluated).not.toHaveBeenCalled();
      expect(clientConstructor).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock(workerPath);
    }
  });
});
