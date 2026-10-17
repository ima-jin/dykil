import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/dist/server/web/spec-extension/request';
import type { NextResponse } from 'next/server';

const { readKeystoreMock, resolveKeystorePathMock } = vi.hoisted(() => ({
  readKeystoreMock: vi.fn(),
  resolveKeystorePathMock: vi.fn(() => '/tmp/keystore.json'),
}));

vi.mock('@ima-jin/auth-client', () => ({
  readKeystore: readKeystoreMock,
  resolveKeystorePath: resolveKeystorePathMock,
}));

/** Runs the middleware for `path` with the given claim state, mocking only the on-disk keystore check. */
async function middlewareFor(
  path: string,
  options: { claimed: boolean; basePath?: string },
): Promise<NextResponse> {
  readKeystoreMock.mockReturnValue(options.claimed ? { publicKey: 'pub', privateKey: 'priv' } : null);
  const { middleware } = await import('../middleware');
  // Use Next's real NextURL normalization: deployed middleware sees '/'
  // with basePath '/dykil', rather than pathname '/dykil'.
  return middleware(new NextRequest(new URL(path, 'http://localhost:3000'), {
    nextConfig: { basePath: options.basePath },
  }));
}

describe('middleware', () => {
  afterEach(() => {
    readKeystoreMock.mockReset();
    resolveKeystorePathMock.mockClear();
    vi.unstubAllEnvs();
  });

  it('serves the "not claimed yet" page for an ordinary route when unclaimed', async () => {
    const response = await middlewareFor('/', { claimed: false });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('not claimed yet');
    expect(text).toContain('href="/dykil/claim"');
    expect(text).toContain('/jin approval card');
  });

  it('passes /claim through when unclaimed', async () => {
    const response = await middlewareFor('/claim', { claimed: false });

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes /api/health and /api/claim through when unclaimed', async () => {
    expect((await middlewareFor('/api/health', { claimed: false })).headers.get('x-middleware-next')).toBe('1');
    expect((await middlewareFor('/api/claim', { claimed: false })).headers.get('x-middleware-next')).toBe('1');
  });

  it('404s /claim once claimed', async () => {
    const response = await middlewareFor('/claim', { claimed: true });

    expect(response.status).toBe(404);
  });

  it('404s /api/claim once claimed', async () => {
    const response = await middlewareFor('/api/claim', { claimed: true });

    expect(response.status).toBe(404);
  });

  it('passes ordinary routes through once claimed', async () => {
    const response = await middlewareFor('/', { claimed: true });

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  describe('SDK root callback forwarding', () => {
    const query = '?attestation_id=att%2F123&user_did=did%3Aimajin%3Aoperator&state=a%2Bb&state=c';

    it.each(['/dykil', '/dykil/'])('forwards the raw root %s with the identical query', async (root) => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://public.example/dykil');
      const response = await middlewareFor(`${root}${query}`, { claimed: true });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`https://public.example/dykil/api/auth/callback${query}`);
    });

    it.each(['/dykil', '/dykil/'])('forwards the Next-normalized root %s', async (root) => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://public.example/dykil');
      const response = await middlewareFor(`${root}${query}`, { claimed: true, basePath: '/dykil' });

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`https://public.example/dykil/api/auth/callback${query}`);
    });

    it('uses the configured basePath even when the public URL contains only the origin', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://public.example');
      const response = await middlewareFor(`/dykil${query}`, { claimed: true, basePath: '/dykil' });

      expect(response.headers.get('location')).toBe(`https://public.example/dykil/api/auth/callback${query}`);
    });

    it.each([
      '',
      '?attestation_id=att-123',
      '?user_did=did:imajin:operator',
      '?attestation_id=&user_did=did:imajin:operator',
      '?attestation_id=att-123&user_did=',
    ])('passes through root requests without both nonempty parameters (%s)', async (search) => {
      const response = await middlewareFor(`/dykil${search}`, { claimed: true, basePath: '/dykil' });

      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.has('location')).toBe(false);
    });

    it.each(['/dykil/api/auth/callback', '/dykil/surveys'])('does not re-forward %s', async (path) => {
      const response = await middlewareFor(`${path}${query}`, { claimed: true, basePath: '/dykil' });

      expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('forwards before claim checks, but the callback destination remains gated when unclaimed', async () => {
      const response = await middlewareFor(`/dykil${query}`, { claimed: false, basePath: '/dykil' });
      expect(response.status).toBe(307);
      expect(readKeystoreMock).not.toHaveBeenCalled();

      const destination = new URL(response.headers.get('location')!);
      const callbackResponse = await middlewareFor(`${destination.pathname}${destination.search}`, {
        claimed: false,
        basePath: '/dykil',
      });
      expect(callbackResponse.headers.has('location')).toBe(false);
      expect(await callbackResponse.text()).toContain('Not claimed yet');
    });

    it('keeps incomplete callbacks behind the claim gate', async () => {
      const response = await middlewareFor('/dykil?attestation_id=att-123', {
        claimed: false,
        basePath: '/dykil',
      });

      expect(await response.text()).toContain('Not claimed yet');
      expect(response.headers.has('location')).toBe(false);
    });

    it('still blocks the single-use claim route after claim even with callback parameters', async () => {
      const response = await middlewareFor(`/dykil/claim${query}`, { claimed: true, basePath: '/dykil' });

      expect(response.status).toBe(404);
      expect(response.headers.has('location')).toBe(false);
    });

    it('keeps the bare-root matcher and Node runtime required by the claim gate', async () => {
      const { config } = await import('../middleware');

      expect(config.runtime).toBe('nodejs');
      expect(config.matcher).toContain('/');
    });
  });
});
