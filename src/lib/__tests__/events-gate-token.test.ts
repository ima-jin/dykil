import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBootstrapKeypair } from '@ima-jin/auth-client';

const { isAppClaimedMock, getSigningIdentityMock } = vi.hoisted(() => ({
  isAppClaimedMock: vi.fn(),
  getSigningIdentityMock: vi.fn(),
}));

vi.mock('@/lib/auth/signing-identity', () => ({
  isAppClaimed: isAppClaimedMock,
  getSigningIdentity: getSigningIdentityMock,
}));

import { EVENTS_GATE_SCOPE, GateTokenUnavailableError, KernelGateTokenProvider } from '../events-gate-token';

const ENV_KEYS = ['AUTH_SERVICE_URL', 'IMAJIN_APP_DID', 'DYKIL_EVENTS_AUTHORIZATION_ID'] as const;
const originalEnv: Record<string, string | undefined> = {};

describe('KernelGateTokenProvider', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
    process.env.DYKIL_EVENTS_AUTHORIZATION_ID = 'att_consent_1';
    delete process.env.IMAJIN_APP_DID;
    isAppClaimedMock.mockReset().mockReturnValue(true);
    getSigningIdentityMock.mockReset().mockReturnValue({
      appDid: 'did:imajin:dykil-app',
      privateKey: generateBootstrapKeypair().privateKey,
      publicKey: null,
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is configured only with an authorization id and a claimed app', () => {
    const provider = new KernelGateTokenProvider();
    expect(provider.isConfigured()).toBe(true);

    isAppClaimedMock.mockReturnValue(false);
    expect(provider.isConfigured()).toBe(false);

    isAppClaimedMock.mockReturnValue(true);
    delete process.env.DYKIL_EVENTS_AUTHORIZATION_ID;
    expect(provider.isConfigured()).toBe(false);
  });

  it('mints an events:read token via the proof-of-possession flow, signed with the app\'s own key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok_1', expiresIn: 600 }) });
    vi.stubGlobal('fetch', fetchMock);

    const token = await new KernelGateTokenProvider().getToken();

    expect(token).toBe('tok_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/auth/api/apps/token');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ appDid: 'did:imajin:dykil-app', attestationId: 'att_consent_1', scope: EVENTS_GATE_SCOPE });
    expect(body.nonce.length).toBeGreaterThanOrEqual(16);
    expect(Math.abs(Date.parse(body.timestamp) - Date.now())).toBeLessThan(5000);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('prefers the configured IMAJIN_APP_DID over the identity\'s own appDid', async () => {
    process.env.IMAJIN_APP_DID = 'did:imajin:configured';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok_1', expiresIn: 600 }) });
    vi.stubGlobal('fetch', fetchMock);

    await new KernelGateTokenProvider().getToken();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).appDid).toBe('did:imajin:configured');
  });

  it('caches the token until shortly before it expires, then mints a fresh one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok_1', expiresIn: 600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok_2', expiresIn: 600 }) });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new KernelGateTokenProvider();

    expect(await provider.getToken()).toBe('tok_1');
    vi.advanceTimersByTime(60_000);
    expect(await provider.getToken()).toBe('tok_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(520_000); // 580s elapsed, inside the 30s refresh skew of the 600s TTL
    expect(await provider.getToken()).toBe('tok_2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to mint when the app is unclaimed or no authorization id is set', async () => {
    isAppClaimedMock.mockReturnValue(false);
    await expect(new KernelGateTokenProvider().getToken()).rejects.toBeInstanceOf(GateTokenUnavailableError);

    isAppClaimedMock.mockReturnValue(true);
    delete process.env.DYKIL_EVENTS_AUTHORIZATION_ID;
    await expect(new KernelGateTokenProvider().getToken()).rejects.toBeInstanceOf(GateTokenUnavailableError);
  });

  it('surfaces the kernel\'s refusal as GateTokenUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Scope not granted' }) }));
    await expect(new KernelGateTokenProvider().getToken()).rejects.toMatchObject({
      name: 'GateTokenUnavailableError',
      message: 'Scope not granted',
    });
  });

  it('uses a generic message when the kernel refusal has no body, or answers ok without a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error('x')) }));
    await expect(new KernelGateTokenProvider().getToken()).rejects.toThrow('Kernel refused to mint the events gate token (500)');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await expect(new KernelGateTokenProvider().getToken()).rejects.toThrow('Kernel refused to mint the events gate token (200)');
  });

  it('treats a token with no expiresIn as already stale, minting again next time', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'tok_x' }) });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new KernelGateTokenProvider();
    await provider.getToken();
    await provider.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
