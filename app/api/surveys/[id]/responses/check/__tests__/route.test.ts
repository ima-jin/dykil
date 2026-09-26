import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
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

function req(query = '') {
  return new NextRequest(`https://dykil.imajin.ai/api/surveys/asset_1/responses/check${query}`);
}

describe('OPTIONS /api/surveys/:id/responses/check', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(req());
    expect(response.status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/:id/responses/check', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    readOwnerSurveyAssetMock.mockResolvedValue(null);
  });

  it('returns completed:false for an anonymous caller with no ticketId', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await GET(req(), params('asset_1'));
    const body = await response.json();

    expect(body).toEqual({ completed: false });
    expect(listAttestationsMock).not.toHaveBeenCalled();
  });

  it("checks by the authenticated caller's own issuer_did", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    listAttestationsMock.mockResolvedValue([
      { id: 'att_1', contextId: 'asset_1', issuerDid: 'did:imajin:respondent', payload: { answers: { q1: 'yes' } } },
    ]);

    const response = await GET(req('?include=answers'), params('asset_1'));
    const body = await response.json();

    expect(body.completed).toBe(true);
    expect(body.responseId).toBe('att_1');
    expect(body.answers).toEqual({ q1: 'yes' });

    const [query] = listAttestationsMock.mock.calls[0];
    expect(query.issuerDid).toBe('did:imajin:respondent');
  });

  it('checks by ticketId without requiring authentication, and never reads raw ticket rows', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    listAttestationsMock
      .mockResolvedValueOnce([]) // respondent-signed (issuerDid undefined -> broad fetch)
      .mockResolvedValueOnce([{ id: 'att_legacy', contextId: 'asset_1', payload: { ticketId: 'tkt_1' } }]);

    const response = await GET(req('?ticketId=tkt_1'), params('asset_1'));
    const body = await response.json();

    expect(body).toEqual({ completed: true, responseId: 'att_legacy' });
  });

  it('returns completed:false when no matching response exists', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    listAttestationsMock.mockResolvedValue([]);

    const response = await GET(req(), params('asset_1'));
    expect(await response.json()).toEqual({ completed: false });
  });

  it('404s when the survey does not exist', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await GET(req('?ticketId=tkt_1'), params('missing'));
    expect(response.status).toBe(404);
  });

  it('returns 500 when the kernel call fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    listAttestationsMock.mockRejectedValue(new Error('boom'));

    const response = await GET(req(), params('asset_1'));
    expect(response.status).toBe(500);
  });

  it('surfaces a KernelAttestationError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    const { KernelAttestationError } = await import('@/lib/kernel/attestations');
    listAttestationsMock.mockRejectedValue(new KernelAttestationError('Kernel down', 502, null));

    const response = await GET(req(), params('asset_1'));
    expect(response.status).toBe(502);
  });
});
