import { beforeEach, describe, expect, it } from 'vitest';
import {
  asCaller,
  authenticateMock,
  listAllAttestationsMock,
  listAttestationsPageMock,
  publishedSurveyDocFixture as doc,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';
import { KernelAttestationError } from '@/lib/kernel/attestations';

import { GET, OPTIONS } from '../route';

function listRequest(query = '', headers: Record<string, string> = {}) {
  return new Request(`https://dykil.imajin.ai/api/surveys/asset_1/responses${query}`, { headers });
}

const responseRow = (id: string, type = 'dykil/survey-response') => ({ id, type, contextId: 'asset_1' });

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

    const response = await GET(listRequest() as never, params('asset_1'));
    expect(response.status).toBe(401);
  });

  it('requires the dykil:read scope', async () => {
    authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:read', status: 403 });

    const response = await GET(listRequest() as never, params('asset_1'));

    expect(response.status).toBe(403);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:read'] });
  });

  it('404s when the survey does not exist', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/missing/responses') as never, params('missing'));
    expect(response.status).toBe(404);
  });

  it('returns 403 when the caller does not own the survey', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:someone-else'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);

    const response = await GET(listRequest() as never, params('asset_1'));
    expect(response.status).toBe(403);
    expect(listAllAttestationsMock).not.toHaveBeenCalled();
  });

  it('exports every response by following the kernel cursor, with the caller credentials forwarded', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      responseRow('att_new'),
      responseRow('att_legacy', 'dykil/survey-response-legacy-import'),
      { id: 'att_unrelated', type: 'media.something', contextId: 'asset_1' },
    ]);

    const response = await GET(listRequest('', { authorization: 'Bearer owner-token' }) as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.responses.map((row: { id: string }) => row.id)).toEqual(['att_new', 'att_legacy']);
    expect(listAllAttestationsMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: undefined, ref: undefined },
      { authorization: 'Bearer owner-token' },
    );
    expect(listAttestationsPageMock).not.toHaveBeenCalled();
  });

  it('returns a single page with nextCursor when limit is given', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAttestationsPageMock.mockResolvedValue({ rows: [responseRow('att_2')], nextCursor: '2026-01-01T00:00:00.000Z,att_2' });

    const response = await GET(listRequest('?limit=1', { cookie: 'imajin_session=abc' }) as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ responses: [responseRow('att_2')], nextCursor: '2026-01-01T00:00:00.000Z,att_2' });
    expect(listAttestationsPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ subjectDid: 'did:imajin:owner', contextId: 'asset_1', limit: 1, before: undefined }),
      { cookie: 'imajin_session=abc' },
    );
    expect(listAllAttestationsMock).not.toHaveBeenCalled();
  });

  it('passes the cursor through as the kernel before parameter, and caps the page size at 100', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAttestationsPageMock.mockResolvedValue({ rows: [], nextCursor: null });

    const response = await GET(listRequest('?limit=5000&cursor=c1') as never, params('asset_1'));
    const body = await response.json();

    expect(body).toEqual({ responses: [], nextCursor: null });
    expect(listAttestationsPageMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, before: 'c1' }), {});
  });

  it('pages with the default size when only a cursor is given', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAttestationsPageMock.mockResolvedValue({ rows: [], nextCursor: null });

    await GET(listRequest('?cursor=c9') as never, params('asset_1'));

    expect(listAttestationsPageMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, before: 'c9' }), {});
  });

  it.each(['0', '-3', 'abc'])('rejects limit=%s', async (limit) => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));

    const response = await GET(listRequest(`?limit=${limit}`) as never, params('asset_1'));

    expect(response.status).toBe(400);
  });

  it('reads a draft survey for its owner through the owner read', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue({ content: { ...doc, status: 'draft' }, filename: 'f.json' });
    listAllAttestationsMock.mockResolvedValue([]);

    const response = await GET(listRequest() as never, params('asset_1'));

    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(0);
  });

  it('returns 500 when the kernel call fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockRejectedValue(new Error('boom'));

    const response = await GET(listRequest() as never, params('asset_1'));
    expect(response.status).toBe(500);
  });

  it('surfaces a KernelAttestationError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:owner'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockRejectedValue(new KernelAttestationError('Kernel rejected', 502, null));

    const response = await GET(listRequest() as never, params('asset_1'));
    expect(response.status).toBe(502);
  });
});
