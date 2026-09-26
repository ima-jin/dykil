import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function req(query = '') {
  return new NextRequest(`https://dykil.imajin.ai/api/surveys/asset_1/responses/check${query}`);
}

describe('GET /api/surveys/:id/responses/check', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readPublicSurveyAssetMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
    listAttestationsMock.mockReset();
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
});
