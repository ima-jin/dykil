import { beforeEach, describe, expect, it } from 'vitest';
import {
  asCaller,
  authenticateMock,
  listAllAttestationsMock,
  publishedSurveyDocFixture as doc,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';
import { KernelAttestationError } from '@/lib/kernel/attestations';

import { GET, OPTIONS } from '../route';

function checkRequest(query = '', headers: Record<string, string> = {}) {
  return new Request(`https://dykil.imajin.ai/api/surveys/asset_1/responses/check${query}`, { headers });
}

describe('OPTIONS /api/surveys/:id/responses/check', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses/check') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/:id/responses/check', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
  });

  it('requires authentication — the unauthenticated lookup was not carried over', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await GET(checkRequest('?ticketId=tkt_1') as never, params('asset_1'));

    expect(response.status).toBe(401);
    expect(listAllAttestationsMock).not.toHaveBeenCalled();
  });

  it('requires the dykil:read scope', async () => {
    authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:read', status: 403 });

    const response = await GET(checkRequest() as never, params('asset_1'));

    expect(response.status).toBe(403);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:read'] });
  });

  it("checks by the authenticated caller's own issuer_did, forwarding their credentials", async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_1', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent', payload: { answers: { q1: 'yes' } } },
    ]);

    const response = await GET(checkRequest('', { authorization: 'Bearer respondent-token' }) as never, params('asset_1'));
    const body = await response.json();

    expect(body).toEqual({ completed: true, responseId: 'att_1' });
    expect(listAllAttestationsMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: 'did:imajin:respondent', ref: undefined },
      { authorization: 'Bearer respondent-token' },
    );
  });

  it('includes the stored answers only when asked', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_1', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent', payload: { answers: { q1: 'yes' } } },
    ]);

    const response = await GET(checkRequest('?include=answers') as never, params('asset_1'));

    expect(await response.json()).toEqual({ completed: true, responseId: 'att_1', answers: { q1: 'yes' } });
  });

  it('reports null answers when a matching response carries none', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_1', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent', payload: null },
    ]);

    const response = await GET(checkRequest('?include=answers') as never, params('asset_1'));

    expect((await response.json()).answers).toBeNull();
  });

  it('checks by the indexed ref for ?ticketId=, never by scanning payloads or reading ticket rows', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_other', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent', payload: { ticketId: 'tkt_2' } },
      { id: 'att_tkt', type: 'dykil/survey-response-legacy-import', issuerDid: 'did:imajin:dykil-app', payload: { ticketId: 'tkt_1' } },
    ]);

    const response = await GET(checkRequest('?ticketId=tkt_1') as never, params('asset_1'));
    const body = await response.json();

    expect(body).toEqual({ completed: true, responseId: 'att_tkt' });
    expect(listAllAttestationsMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: undefined, ref: 'tkt_1' },
      {},
    );
  });

  it('returns completed:false when no matching response exists', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([]);

    const response = await GET(checkRequest() as never, params('asset_1'));

    expect(await response.json()).toEqual({ completed: false });
  });

  it('ignores a response carrying a different issuer or an unrelated type', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_x', type: 'dykil/survey-response', issuerDid: 'did:imajin:someone-else', payload: {} },
    ]);

    const response = await GET(checkRequest() as never, params('asset_1'));

    expect(await response.json()).toEqual({ completed: false });
  });

  it('404s when the survey does not exist', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const response = await GET(checkRequest() as never, params('missing'));

    expect(response.status).toBe(404);
  });

  it('surfaces a KernelAttestationError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockRejectedValue(new KernelAttestationError('Kernel rejected', 502, null));

    const response = await GET(checkRequest() as never, params('asset_1'));

    expect(response.status).toBe(502);
  });

  it('returns 500 when the check fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockRejectedValue(new Error('boom'));

    const response = await GET(checkRequest() as never, params('asset_1'));

    expect(response.status).toBe(500);
  });
});
