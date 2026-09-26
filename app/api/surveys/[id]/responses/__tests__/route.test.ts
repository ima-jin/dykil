import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, readPublicSurveyAssetMock, readOwnerSurveyAssetMock, listAttestationsMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  readPublicSurveyAssetMock: vi.fn(),
  readOwnerSurveyAssetMock: vi.fn(),
  listAttestationsMock: vi.fn(),
}));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, readPublicSurveyAsset: readPublicSurveyAssetMock, readOwnerSurveyAsset: readOwnerSurveyAssetMock };
});
vi.mock('@/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/attestations')>('@/lib/kernel/attestations');
  return { ...actual, listAttestations: listAttestationsMock };
});

import { GET } from '../route';

const doc = {
  schema: 'dykil.survey/v1',
  ownerDid: 'did:imajin:owner',
  title: 'Feedback',
  description: null,
  fields: { elements: [] },
  settings: {},
  type: 'survey',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/surveys/:id/responses', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readPublicSurveyAssetMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
    listAttestationsMock.mockReset();
  });

  it('returns 403 when the caller does not own the survey', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:someone-else', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(doc);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never, params('asset_1'));
    expect(response.status).toBe(403);
  });

  it('merges respondent-signed and node-witnessed-legacy-import attestations, filtered to this survey, newest first', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(doc);

    listAttestationsMock
      .mockResolvedValueOnce([
        { id: 'att_old', contextId: 'asset_1', issuedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'att_other_survey', contextId: 'asset_2', issuedAt: '2026-01-03T00:00:00.000Z' },
      ])
      .mockResolvedValueOnce([{ id: 'att_legacy', contextId: 'asset_1', issuedAt: '2026-01-02T00:00:00.000Z' }]);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.responses.map((r: { id: string }) => r.id)).toEqual(['att_legacy', 'att_old']);
  });
});
