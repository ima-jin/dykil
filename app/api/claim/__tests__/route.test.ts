import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSigningIdentityForTests } from '@/lib/auth/signing-identity';
import { resetClaimRateLimitForTests } from '@/lib/claim-rate-limit';
import { POST } from '../route';

const ENV_KEYS = ['IMAJIN_KERNEL_URL', 'IMAJIN_APP_DID', 'IMAJIN_APP_CLAIM_CODE', 'IMAJIN_APP_KEYSTORE'] as const;
const originalEnv: Record<string, string | undefined> = {};
const RATE_LIMIT = 5;

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://dykil.imajin.ai/api/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function mockKernelClaim(responseBody: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => responseBody });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('POST /api/claim', () => {
  let keystoreDir: string;
  let keystorePath: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    keystoreDir = mkdtempSync(join(tmpdir(), 'dykil-claim-route-'));
    keystorePath = join(keystoreDir, 'keystore.json');
    process.env.IMAJIN_KERNEL_URL = 'https://dev-jin.imajin.ai';
    process.env.IMAJIN_APP_KEYSTORE = keystorePath;
  });

  afterEach(() => {
    resetSigningIdentityForTests();
    resetClaimRateLimitForTests();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.unstubAllGlobals();
    rmSync(keystoreDir, { recursive: true, force: true });
  });

  it('redeems a valid claim code, persists a 0600 keystore, and never returns the private key', async () => {
    mockKernelClaim({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' });

    const response = await POST(postRequest({ claimCode: 'operator-pasted-code' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ appDid: 'did:imajin:dykil-app', publicKey: 'pub-hex' });
    expect(body.privateKey).toBeUndefined();

    expect(existsSync(keystorePath)).toBe(true);
    expect(statSync(keystorePath).mode & 0o777).toBe(0o600);
  });

  it('rejects a missing claim code without calling the kernel', async () => {
    const fetchMock = mockKernelClaim({});

    const response = await POST(postRequest({}) as never);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a kernel refusal to a generic 400 without leaking the kernel error body', async () => {
    mockKernelClaim({ error: 'This claim code has already been redeemed' }, false);

    const response = await POST(postRequest({ claimCode: 'spent-code' }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('404s once this app is already claimed', async () => {
    mockKernelClaim({ appDid: 'did:imajin:dykil-app', privateKey: 'deadbeef', publicKey: 'pub-hex' });
    await POST(postRequest({ claimCode: 'first-code' }) as never);

    const response = await POST(postRequest({ claimCode: 'second-code' }) as never);

    expect(response.status).toBe(404);
  });

  it('rate-limits repeated attempts from the same client', async () => {
    mockKernelClaim({ error: 'Unrecognized claim code' }, false);

    for (let attempt = 0; attempt < RATE_LIMIT; attempt += 1) {
      await POST(postRequest({ claimCode: `attempt-${attempt}` }, { 'x-forwarded-for': '203.0.113.5' }) as never);
    }
    const response = await POST(
      postRequest({ claimCode: 'one-attempt-too-many' }, { 'x-forwarded-for': '203.0.113.5' }) as never
    );

    expect(response.status).toBe(429);
  });

  it('keys the rate limit on the trusted LAST X-Forwarded-For hop, not the spoofable leading one', async () => {
    mockKernelClaim({ error: 'Unrecognized claim code' }, false);

    // A different, attacker-controlled leading hop on every request, but the
    // same trailing hop — the one this app's own front-door proxy actually
    // appends. If the limiter (still, wrongly) keyed on the first hop, this
    // loop would never trip the limit at all.
    for (let attempt = 0; attempt < RATE_LIMIT; attempt += 1) {
      await POST(
        postRequest({ claimCode: `attempt-${attempt}` }, { 'x-forwarded-for': `10.0.0.${attempt}, 203.0.113.5` }) as never
      );
    }
    const response = await POST(
      postRequest({ claimCode: 'one-attempt-too-many' }, { 'x-forwarded-for': '10.0.0.99, 203.0.113.5' }) as never
    );

    expect(response.status).toBe(429);
  });

  it('ignores a spoofed x-real-ip and a spoofed leading X-Forwarded-For hop: neither bypasses the limit', async () => {
    mockKernelClaim({ error: 'Unrecognized claim code' }, false);

    // Fresh attacker-controlled x-real-ip AND leading XFF hop on every
    // request; only the trailing XFF hop (the proxy's) is constant.
    for (let attempt = 0; attempt < RATE_LIMIT; attempt += 1) {
      await POST(
        postRequest(
          { claimCode: `attempt-${attempt}` },
          { 'x-real-ip': `198.51.100.${attempt}`, 'x-forwarded-for': `10.0.0.${attempt}, 203.0.113.5` }
        ) as never
      );
    }
    const response = await POST(
      postRequest(
        { claimCode: 'one-attempt-too-many' },
        { 'x-real-ip': '198.51.100.99', 'x-forwarded-for': '10.0.0.99, 203.0.113.5' }
      ) as never
    );

    expect(response.status).toBe(429);
  });

  it('refuses a claim whose kernel-returned appDid does not match IMAJIN_APP_DID, and persists nothing', async () => {
    process.env.IMAJIN_APP_DID = 'did:imajin:this-app';
    mockKernelClaim({ appDid: 'did:imajin:a-different-app', privateKey: 'deadbeef', publicKey: 'pub-hex' });

    const response = await POST(postRequest({ claimCode: 'operator-pasted-code' }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.expectedAppDid).toBe('did:imajin:this-app');
    expect(body.claimedAppDid).toBe('did:imajin:a-different-app');
    expect(body.error).not.toContain('operator-pasted-code');
    expect(existsSync(keystorePath)).toBe(false);
  });
});
