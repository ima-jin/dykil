import { beforeEach, describe, expect, it } from 'vitest';
import {
  asCaller,
  authenticateMock,
  listAllAttestationsMock,
  publishedSurveyDocFixture as doc,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  revokeAttestationMock,
} from '@/test/helpers/survey-route-mocks';
import { KernelAttestationError } from '@/lib/kernel/attestations';

import { DELETE, OPTIONS } from '../route';

function params(id: string, responseId: string) {
  return { params: Promise.resolve({ id, responseId }) };
}

function withdrawRequest(headers: Record<string, string> = {}) {
  return new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses/att_1', { method: 'DELETE', headers });
}

const mine = { id: 'att_1', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent' };

describe('OPTIONS /api/surveys/:id/responses/:responseId', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1/responses/att_1') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('DELETE /api/surveys/:id/responses/:responseId', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([mine]);
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await DELETE(withdrawRequest() as never, params('asset_1', 'att_1'));

    expect(response.status).toBe(401);
    expect(revokeAttestationMock).not.toHaveBeenCalled();
  });

  it('requires the dykil:write scope', async () => {
    authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:write', status: 403 });

    const response = await DELETE(withdrawRequest() as never, params('asset_1', 'att_1'));

    expect(response.status).toBe(403);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:write'] });
  });

  it('404s when the survey does not exist', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const response = await DELETE(withdrawRequest() as never, params('missing', 'att_1'));

    expect(response.status).toBe(404);
    expect(revokeAttestationMock).not.toHaveBeenCalled();
  });

  it("revokes the caller's own response through the kernel, with their credentials", async () => {
    revokeAttestationMock.mockResolvedValue({ id: 'att_1', revokedAt: '2026-10-06T00:00:00.000Z' });

    const response = await DELETE(withdrawRequest({ authorization: 'Bearer respondent-token' }) as never, params('asset_1', 'att_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ revoked: true, id: 'att_1', revokedAt: '2026-10-06T00:00:00.000Z' });
    expect(listAllAttestationsMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: 'did:imajin:respondent' },
      { authorization: 'Bearer respondent-token' },
    );
    expect(revokeAttestationMock).toHaveBeenCalledWith('att_1', { authorization: 'Bearer respondent-token' });
  });

  it("404s an id that is not one of the caller's own active responses to this survey, without calling the kernel", async () => {
    const response = await DELETE(withdrawRequest() as never, params('asset_1', 'att_someone_elses'));

    expect(response.status).toBe(404);
    expect(revokeAttestationMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'Only the attestation issuer can revoke'],
    [404, 'Attestation not found'],
    [409, 'Attestation is already revoked'],
  ])("passes the kernel's %i through", async (status, message) => {
    revokeAttestationMock.mockRejectedValue(new KernelAttestationError(message, status, null));

    const response = await DELETE(withdrawRequest() as never, params('asset_1', 'att_1'));

    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(message);
  });

  it('returns 500 when the withdrawal fails unexpectedly', async () => {
    revokeAttestationMock.mockRejectedValue(new Error('boom'));

    const response = await DELETE(withdrawRequest() as never, params('asset_1', 'att_1'));

    expect(response.status).toBe(500);
  });
});
