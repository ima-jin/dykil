import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSessionOrAppTokenMock } = vi.hoisted(() => ({ requireSessionOrAppTokenMock: vi.fn() }));

vi.mock('@ima-jin/auth', () => ({
  requireSessionOrAppToken: requireSessionOrAppTokenMock,
}));

describe('authenticate', () => {
  beforeEach(() => {
    requireSessionOrAppTokenMock.mockReset();
    process.env.NEXT_PUBLIC_APP_URL = 'https://dykil.imajin.ai';
  });

  it("scopes the audience to this app's own host, mirroring coffee's #1974 adoption", async () => {
    requireSessionOrAppTokenMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    const { authenticate } = await import('../authenticate');

    const request = new Request('https://dykil.imajin.ai/api/surveys');
    const result = await authenticate(request);

    expect(requireSessionOrAppTokenMock).toHaveBeenCalledWith(request, { aud: 'dykil.imajin.ai', requireScopes: undefined });
    expect('auth' in result && result.auth.did).toBe('did:imajin:respondent');
  });

  it('forwards a failure as { error, status }', async () => {
    requireSessionOrAppTokenMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const { authenticate } = await import('../authenticate');

    const result = await authenticate(new Request('https://dykil.imajin.ai/api/surveys'));

    expect(result).toEqual({ error: 'Not authenticated', status: 401 });
  });

  it('forwards requireScopes through to the underlying check', async () => {
    requireSessionOrAppTokenMock.mockResolvedValue({ error: 'Missing required scope(s): survey:write', status: 403 });
    const { authenticate } = await import('../authenticate');

    await authenticate(new Request('https://dykil.imajin.ai/api/surveys'), { requireScopes: ['survey:write'] });

    expect(requireSessionOrAppTokenMock).toHaveBeenCalledWith(expect.anything(), {
      aud: 'dykil.imajin.ai',
      requireScopes: ['survey:write'],
    });
  });
});
