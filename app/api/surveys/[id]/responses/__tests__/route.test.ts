import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateMock,
  listAttestationsMock,
  publishedSurveyDocFixture as doc,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';

import { GET, OPTIONS } from '../route';

describe('OPTIONS /api/surveys/:id/responses', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/:id/responses', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never, params('asset_1'));
    expect(response.status).toBe(401);
  });

  it('404s when the survey does not exist', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/missing/responses') as never, params('missing'));
    expect(response.status).toBe(404);
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

  it('returns 500 when the kernel call fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAttestationsMock.mockRejectedValue(new Error('boom'));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never, params('asset_1'));
    expect(response.status).toBe(500);
  });

  it('surfaces a KernelAttestationError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    const { KernelAttestationError } = await import('@/lib/kernel/attestations');
    listAttestationsMock.mockRejectedValue(new KernelAttestationError('Kernel down', 502, null));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses') as never, params('asset_1'));
    expect(response.status).toBe(502);
  });
});
