import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock } = vi.hoisted(() => ({ authenticateMock: vi.fn() }));
vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));

import { GET } from '../route';

describe('GET /api/session', () => {
  beforeEach(() => authenticateMock.mockReset());

  it("returns the caller's own DID", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:me', scopes: [], via: 'token' } });
    const response = await GET(new Request('https://dykil.imajin.ai/api/session') as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ did: 'did:imajin:me' });
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:read'] });
  });

  it.each([
    [401, 'Not authenticated'],
    [403, 'Missing required scope(s): dykil:read'],
  ])('passes a %i refusal through', async (status, error) => {
    authenticateMock.mockResolvedValue({ error, status });
    const response = await GET(new Request('https://dykil.imajin.ai/api/session') as never);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
