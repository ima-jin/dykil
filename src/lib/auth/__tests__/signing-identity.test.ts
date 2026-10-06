import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['IMAJIN_KERNEL_URL', 'IMAJIN_APP_DID', 'IMAJIN_APP_CLAIM_CODE', 'IMAJIN_APP_KEYSTORE'] as const;
const originalEnv: Record<string, string | undefined> = {};
const SIGNING_IDENTITY_KEY = Symbol.for('imajin.app.signingIdentity');

interface GlobalIdentitySlot {
  [SIGNING_IDENTITY_KEY]?: unknown;
}

/** The identity now lives on `globalThis`, so it must be cleared explicitly between cases. */
function clearGlobalIdentity(): void {
  delete (globalThis as GlobalIdentitySlot)[SIGNING_IDENTITY_KEY];
}

/**
 * Registers the shared temp-keystore env setup/teardown for a `describe`
 * block via `beforeEach`/`afterEach` (call this at the top of the
 * `describe` callback, same as writing the hooks inline) and returns an
 * accessor for the current test's keystore path. Shared by both describe
 * blocks below to avoid duplicating this setup verbatim.
 */
function useKeystoreEnv(tmpPrefix: string): { keystorePath: () => string } {
  let keystoreDir = '';
  let keystorePath = '';

  beforeEach(() => {
    vi.resetModules();
    clearGlobalIdentity();
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    keystoreDir = mkdtempSync(join(tmpdir(), tmpPrefix));
    keystorePath = join(keystoreDir, 'keystore.json');
    process.env.IMAJIN_KERNEL_URL = 'https://dev-jin.imajin.ai';
    process.env.IMAJIN_APP_KEYSTORE = keystorePath;
  });

  afterEach(() => {
    clearGlobalIdentity();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    rmSync(keystoreDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  return { keystorePath: () => keystorePath };
}

/**
 * These tests exercise the REAL `@ima-jin/auth-client` `loadAppSigningKey()`
 * (never mocked) through this app's own thin wrapper, mocking only the
 * kernel's HTTP surface — so a wrong env var name or a wrong keystore path
 * would fail these tests exactly as it would fail a real boot.
 */
describe('src/lib/auth/signing-identity', () => {
  const env = useKeystoreEnv('dykil-keystore-');

  it('first boot: redeems the claim code for the signing key and persists a bootstrap keystore', async () => {
    process.env.IMAJIN_APP_CLAIM_CODE = 'one-time-code';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSigningIdentity, getSigningIdentity, isAppClaimed } = await import('../signing-identity');
    await bootstrapSigningIdentity();

    expect(getSigningIdentity()).toEqual({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' });
    expect(isAppClaimed()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/api/apps/claim');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ claimCode: 'one-time-code' });
    expect(existsSync(env.keystorePath())).toBe(true);
    expect(statSync(env.keystorePath()).mode & 0o777).toBe(0o600);
  });

  it('second boot: signs a fresh challenge with the persisted bootstrap key, spending no claim code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    process.env.IMAJIN_APP_CLAIM_CODE = 'one-time-code';
    const firstBoot = await import('../signing-identity');
    await firstBoot.bootstrapSigningIdentity();
    fetchMock.mockClear();

    vi.resetModules();
    delete process.env.IMAJIN_APP_CLAIM_CODE;
    process.env.IMAJIN_APP_DID = 'did:imajin:dykil-app';

    const { bootstrapSigningIdentity, getSigningIdentity, isAppClaimed } = await import('../signing-identity');
    await bootstrapSigningIdentity();

    expect(getSigningIdentity().appDid).toBe('did:imajin:dykil-app');
    expect(isAppClaimed()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/api/apps/signing-key/fetch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ appDid: 'did:imajin:dykil-app' });
  });

  it('unclaimed boot mode (imajin-ai#2427): no keystore and no claim code boots without throwing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSigningIdentity, getSigningIdentity, isAppClaimed } = await import('../signing-identity');

    await expect(bootstrapSigningIdentity()).resolves.toBeUndefined();

    expect(isAppClaimed()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => getSigningIdentity()).toThrow(/not bootstrapped/);
  });

  it('still fails loud when a claim code IS provided but the kernel rejects it', async () => {
    process.env.IMAJIN_APP_CLAIM_CODE = 'bad-code';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Unrecognized claim code' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSigningIdentity, isAppClaimed } = await import('../signing-identity');

    await expect(bootstrapSigningIdentity()).rejects.toThrow();
    expect(isAppClaimed()).toBe(false);
  });

  it('shares the identity across separately-loaded module copies (instrumentation.ts vs route bundles)', async () => {
    const fixtureIdentity = { appDid: 'did:imajin:dykil-app', privateKey: 'fixture-private', publicKey: 'fixture-public' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => fixtureIdentity });
    vi.stubGlobal('fetch', fetchMock);
    process.env.IMAJIN_APP_CLAIM_CODE = 'one-time-code';

    // Copy A stands in for the bundle `instrumentation.ts` boots from...
    const instrumentationCopy = await import('../signing-identity');
    await instrumentationCopy.bootstrapSigningIdentity();

    // ...copy B for a distinct route bundle: a fresh module instance with its own module scope.
    vi.resetModules();
    const routeCopy = await import('../signing-identity');
    expect(routeCopy).not.toBe(instrumentationCopy);

    expect(routeCopy.isAppClaimed()).toBe(true);
    expect(routeCopy.getSigningIdentity()).toEqual(fixtureIdentity);
  });

  it('reads the identity from the Symbol.for(imajin.app.signingIdentity) slot on globalThis', async () => {
    const fixtureIdentity = { appDid: 'did:imajin:dykil-app', privateKey: 'fixture-private', publicKey: 'fixture-public' };
    const { getSigningIdentity, isAppClaimed, resetSigningIdentityForTests } = await import('../signing-identity');
    expect(isAppClaimed()).toBe(false);

    (globalThis as GlobalIdentitySlot)[SIGNING_IDENTITY_KEY] = fixtureIdentity;

    expect(isAppClaimed()).toBe(true);
    expect(getSigningIdentity()).toBe(fixtureIdentity);

    resetSigningIdentityForTests();
    expect(isAppClaimed()).toBe(false);
    expect((globalThis as GlobalIdentitySlot)[SIGNING_IDENTITY_KEY]).toBeNull();
  });

  it('getSigningIdentity throws before bootstrapSigningIdentity() has succeeded', async () => {
    const { getSigningIdentity } = await import('../signing-identity');
    expect(() => getSigningIdentity()).toThrow(/not bootstrapped/);
  });
});

describe('src/lib/auth/signing-identity — claimWithCode', () => {
  const env = useKeystoreEnv('dykil-claim-page-');

  it('hot-swaps the in-memory signing identity and persists a bootstrap keystore, without needing IMAJIN_APP_CLAIM_CODE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { claimWithCode, getSigningIdentity, isAppClaimed } = await import('../signing-identity');

    expect(isAppClaimed()).toBe(false);

    const identity = await claimWithCode({ claimCode: 'operator-pasted-code' });

    expect(identity.appDid).toBe('did:imajin:dykil-app');
    expect(isAppClaimed()).toBe(true);
    expect(getSigningIdentity()).toEqual(identity);
    expect(existsSync(env.keystorePath())).toBe(true);
    expect(statSync(env.keystorePath()).mode & 0o777).toBe(0o600);
  });

  it('refuses a claim whose kernel-returned appDid does not match IMAJIN_APP_DID, and undoes the keystore write', async () => {
    process.env.IMAJIN_APP_DID = 'did:imajin:this-app';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appDid: 'did:imajin:a-different-app', privateKey: 'deadbeef', publicKey: 'pub-hex' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { AppDidMismatchError, claimWithCode, isAppClaimed } = await import('../signing-identity');

    await expect(claimWithCode({ claimCode: 'operator-pasted-code' })).rejects.toThrow(AppDidMismatchError);

    expect(isAppClaimed()).toBe(false);
    expect(existsSync(env.keystorePath())).toBe(false);
  });
});
