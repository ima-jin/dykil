import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, listMySurveyAssetsMock, readOwnerSurveyAssetMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  listMySurveyAssetsMock: vi.fn(),
  readOwnerSurveyAssetMock: vi.fn(),
}));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, listMySurveyAssets: listMySurveyAssetsMock, readOwnerSurveyAsset: readOwnerSurveyAssetMock };
});

import { GET } from '../route';

describe('GET /api/surveys/mine', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listMySurveyAssetsMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/mine') as never);
    expect(response.status).toBe(401);
  });

  it("lists the caller's own surveys, skipping any asset that is not a valid survey doc", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    listMySurveyAssetsMock.mockResolvedValue([{ id: 'asset_1' }, { id: 'asset_2' }]);
    readOwnerSurveyAssetMock
      .mockResolvedValueOnce({ content: { schema: 'dykil.survey/v1', title: 'Good' }, filename: 'f.json' })
      .mockResolvedValueOnce({ content: { not: 'a survey' }, filename: 'f.json' });

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/mine') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.surveys).toEqual([{ id: 'asset_1', schema: 'dykil.survey/v1', title: 'Good' }]);
  });

  it('surfaces a KernelMediaError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    const { KernelMediaError } = await import('@/lib/kernel/media');
    listMySurveyAssetsMock.mockRejectedValue(new KernelMediaError('Kernel down', 503, null));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/mine') as never);
    expect(response.status).toBe(503);
  });

  it('returns 500 when listing surveys fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    listMySurveyAssetsMock.mockRejectedValue(new Error('boom'));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/mine') as never);
    expect(response.status).toBe(500);
  });
});
