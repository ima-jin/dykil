import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateMock,
  readPublicSurveyAssetMock,
  readOwnerSurveyAssetMock,
  createAttestationMock,
  hasAccessMock,
} = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  readPublicSurveyAssetMock: vi.fn(),
  readOwnerSurveyAssetMock: vi.fn(),
  createAttestationMock: vi.fn(),
  hasAccessMock: vi.fn(),
}));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, readPublicSurveyAsset: readPublicSurveyAssetMock, readOwnerSurveyAsset: readOwnerSurveyAssetMock };
});
vi.mock('@/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/attestations')>('@/lib/kernel/attestations');
  return { ...actual, createAttestation: createAttestationMock };
});
vi.mock('@/lib/ticket-gate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ticket-gate')>('@/lib/ticket-gate');
  return { ...actual, defaultTicketGate: () => ({ hasAccess: hasAccessMock }) };
});

import { POST } from '../route';

const publishedDoc = {
  schema: 'dykil.survey/v1',
  ownerDid: 'did:imajin:owner',
  title: 'Feedback',
  description: null,
  fields: { elements: [{ name: 'q1', type: 'text', title: 'Q1', isRequired: true }] },
  settings: {},
  type: 'survey',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function respondRequest(body: unknown) {
  return new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/surveys/:id/respond', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readPublicSurveyAssetMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
    createAttestationMock.mockReset();
    hasAccessMock.mockReset();
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:respondent', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(publishedDoc);
  });

  it('requires answers, issuedAt, and signature', async () => {
    const response = await POST(respondRequest({}) as never, params('asset_1'));
    expect(response.status).toBe(400);
  });

  it('rejects a response missing a required field', async () => {
    const response = await POST(
      respondRequest({ answers: {}, issuedAt: 1, signature: 'sig' }) as never,
      params('asset_1'),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a response to a non-published survey', async () => {
    readPublicSurveyAssetMock.mockResolvedValue({ ...publishedDoc, status: 'draft' });
    readOwnerSurveyAssetMock.mockResolvedValue(null);
    const response = await POST(
      respondRequest({ answers: { q1: 'yes' }, issuedAt: 1, signature: 'sig' }) as never,
      params('asset_1'),
    );
    expect(response.status).toBe(403);
  });

  it('forwards a respondent-signed attestation to the kernel, subject = survey owner, issuer = respondent', async () => {
    createAttestationMock.mockResolvedValue({ id: 'att_1' });

    const response = await POST(
      respondRequest({ answers: { q1: 'yes' }, ticketId: 'tkt_1', issuedAt: 1_700_000_000_000, signature: 'sig' }) as never,
      params('asset_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.response).toEqual({ id: 'att_1' });

    const [input] = createAttestationMock.mock.calls[0];
    expect(input.issuerDid).toBe('did:imajin:respondent');
    expect(input.subjectDid).toBe('did:imajin:owner');
    expect(input.type).toBe('dykil/survey-response');
    expect(input.contextId).toBe('asset_1');
    expect(input.payload.provenance).toBe('respondent-signed');
    expect(input.payload.answers).toEqual({ q1: 'yes' });
    expect(input.payload.ticketId).toBe('tkt_1');
    expect(input.signature).toBe('sig');
    expect(input.issuedAt).toBe(1_700_000_000_000);
  });

  it('gates a ticket-scoped survey through the ticket gate, never reading raw ticket rows', async () => {
    readPublicSurveyAssetMock.mockResolvedValue({ ...publishedDoc, settings: { eventId: 'event_1' } });
    hasAccessMock.mockResolvedValue(false);

    const response = await POST(
      respondRequest({ answers: { q1: 'yes' }, issuedAt: 1, signature: 'sig' }) as never,
      params('asset_1'),
    );

    expect(response.status).toBe(403);
    expect(hasAccessMock).toHaveBeenCalledWith({ eventId: 'event_1', did: 'did:imajin:respondent' });
    expect(createAttestationMock).not.toHaveBeenCalled();
  });

  it('allows a ticket-scoped response once the gate says yes', async () => {
    readPublicSurveyAssetMock.mockResolvedValue({ ...publishedDoc, settings: { eventId: 'event_1' } });
    hasAccessMock.mockResolvedValue(true);
    createAttestationMock.mockResolvedValue({ id: 'att_2' });

    const response = await POST(
      respondRequest({ answers: { q1: 'yes' }, issuedAt: 1, signature: 'sig' }) as never,
      params('asset_1'),
    );

    expect(response.status).toBe(201);
  });
});
