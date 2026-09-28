import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['IMAJIN_KERNEL_URL', 'IMAJIN_APP_DID', 'IMAJIN_APP_CLAIM_CODE', 'IMAJIN_APP_KEYSTORE'] as const;
const originalEnv: Record<string, string | undefined> = {};

/**
 * These tests exercise the REAL `@ima-jin/auth-client` `loadAppSigningKey()`
 * (never mocked) through this app's own thin wrapper, mocking only the
 * kernel's HTTP surface — so a wrong env var name or a wrong keystore path
 * would fail these tests exactly as it would fail a real boot.
 */
describe('src/lib/auth/signing-identity', () => {
  let keystoreDir: string;
  let keystorePath: string;

  beforeEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    keystoreDir = mkdtempSync(join(tmpdir(), 'dykil-keystore-'));
    keystorePath = join(keystoreDir, 'keystore.json');
    process.env.IMAJIN_KERNEL_URL = 'https://dev-jin.imajin.ai';
    process.env.IMAJIN_APP_KEYSTORE = keystorePath;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    rmSync(keystoreDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('first boot: redeems the claim code for the signing key and persists a bootstrap keystore', async () => {
    process.env.IMAJIN_APP_CLAIM_CODE = 'one-time-code';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSigningIdentity, getSigningIdentity } = await import('../signing-identity');
    await bootstrapSigningIdentity();

    expect(getSigningIdentity()).toEqual({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/api/apps/claim');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ claimCode: 'one-time-code' });
    expect(existsSync(keystorePath)).toBe(true);
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

    const { bootstrapSigningIdentity, getSigningIdentity } = await import('../signing-identity');
    await bootstrapSigningIdentity();

    expect(getSigningIdentity().appDid).toBe('did:imajin:dykil-app');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/api/apps/signing-key/fetch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ appDid: 'did:imajin:dykil-app' });
  });

  it('no keystore and no claim code: throws a clear, actionable error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { bootstrapSigningIdentity } = await import('../signing-identity');

    await expect(bootstrapSigningIdentity()).rejects.toThrow(/IMAJIN_APP_CLAIM_CODE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getSigningIdentity throws before bootstrapSigningIdentity() has succeeded', async () => {
    const { getSigningIdentity } = await import('../signing-identity');
    expect(() => getSigningIdentity()).toThrow(/not bootstrapped/);
  });
});
