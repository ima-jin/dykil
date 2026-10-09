import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBootstrapKeypair } from '@ima-jin/auth-client';
import { getSigningIdentity, isAppClaimed } from '@/lib/auth/signing-identity';
import {
  appServiceAuthHeaders,
  AppServiceTokenUnavailableError,
  getAppServiceToken,
  resetAppServiceTokenForTests,
} from '../app-service-token';

vi.mock('@/lib/auth/signing-identity', () => ({ isAppClaimed: vi.fn(), getSigningIdentity: vi.fn() }));

const claimed = vi.mocked(isAppClaimed);
const identity = vi.mocked(getSigningIdentity);
const savedEnv = { url: process.env.AUTH_SERVICE_URL, did: process.env.IMAJIN_APP_DID };

function restoreEnv(name: 'AUTH_SERVICE_URL' | 'IMAJIN_APP_DID', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('app service token', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
    delete process.env.IMAJIN_APP_DID;
    resetAppServiceTokenForTests();
    claimed.mockReturnValue(true);
    identity.mockReturnValue({ appDid: 'did:imajin:dykil-app', privateKey: generateBootstrapKeypair().privateKey, publicKey: null });
  });

  afterEach(() => {
    restoreEnv('AUTH_SERVICE_URL', savedEnv.url);
    restoreEnv('IMAJIN_APP_DID', savedEnv.did);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mints the app's own service token with a proof-of-possession signature, no attestation id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok_svc', expiresIn: 600 }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAppServiceToken()).resolves.toBe('tok_svc');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/auth/api/apps/token/service');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.appDid).toBe('did:imajin:dykil-app');
    expect(body).not.toHaveProperty('attestationId');
    expect(body).not.toHaveProperty('scope');
    expect(body.nonce.length).toBeGreaterThanOrEqual(16);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('builds a ready-to-spread Bearer header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok_svc', expiresIn: 600 }) }));
    await expect(appServiceAuthHeaders()).resolves.toEqual({ Authorization: 'Bearer tok_svc' });
  });

  it('caches the token until shortly before it expires, then mints a fresh one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok_1', expiresIn: 600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok_2', expiresIn: 600 }) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await getAppServiceToken()).toBe('tok_1');
    vi.advanceTimersByTime(60_000);
    expect(await getAppServiceToken()).toBe('tok_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(520_000);
    expect(await getAppServiceToken()).toBe('tok_2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses loudly, without calling the kernel, when the app is not claimed', async () => {
    claimed.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAppServiceToken()).rejects.toBeInstanceOf(AppServiceTokenUnavailableError);
    await expect(getAppServiceToken()).rejects.toThrow('has not been claimed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the kernel's refusal, and a generic message when it has no body", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'App is not active' }) }));
    await expect(getAppServiceToken()).rejects.toMatchObject({ name: 'AppServiceTokenUnavailableError', message: 'App is not active' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error('x')) }));
    await expect(getAppServiceToken()).rejects.toThrow('Kernel refused to mint the app service token (500)');
  });
});
