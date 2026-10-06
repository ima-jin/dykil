import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asCaller,
  authenticateMock,
  createAttestationMock,
  listAllAttestationsMock,
  publishedSurveyDocFixture,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';

const { hasAccessMock } = vi.hoisted(() => ({ hasAccessMock: vi.fn() }));

vi.mock('@/lib/ticket-gate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ticket-gate')>('@/lib/ticket-gate');
  return { ...actual, defaultTicketGate: () => ({ hasAccess: hasAccessMock }) };
});

import { OPTIONS, POST } from '../route';
import { GateTokenUnavailableError } from '@/lib/events-gate-token';
import { KernelAttestationError } from '@/lib/kernel/attestations';
import { TicketGateError, TicketGateNotConfiguredError } from '@/lib/ticket-gate';

const doc = {
  ...publishedSurveyDocFixture,
  fields: { elements: [{ name: 'q1', type: 'text', title: 'Q1', isRequired: true }] },
};

function respondRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const signed = { answers: { q1: 'yes' }, issuedAt: 1_700_000_000_000, signature: 'sig' };

function myResponse(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent', ...extra };
}

describe('OPTIONS /api/surveys/:id/respond', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('POST /api/surveys/:id/respond', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
    hasAccessMock.mockReset();
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
    listAllAttestationsMock.mockResolvedValue([]);
  });

  describe('auth and body validation', () => {
    it('returns 401 when unauthenticated — there is no anonymous path', async () => {
      authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(401);
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('requires the dykil:write scope', async () => {
      authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:write', status: 403 });
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(403);
      expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:write'] });
    });

    it('rejects an unparseable JSON body', async () => {
      const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond', { method: 'POST', body: '{not json' });
      const response = await POST(request as never, params('asset_1'));
      expect(response.status).toBe(400);
    });

    it.each([
      ['an empty body', {}],
      ['answers as an array', { ...signed, answers: ['yes'] }],
      ['no issuedAt', { answers: { q1: 'yes' }, signature: 'sig' }],
      ['a non-numeric issuedAt', { ...signed, issuedAt: '1' }],
      ['no signature', { answers: { q1: 'yes' }, issuedAt: 1 }],
      ['a non-string signature', { ...signed, signature: 7 }],
      ['an empty ticketId', { ...signed, ticketId: '' }],
      ['a non-string ticketId', { ...signed, ticketId: 5 }],
      ['an over-long ticketId', { ...signed, ticketId: 't'.repeat(257) }],
      ['an empty supersedes', { ...signed, supersedes: '' }],
      ['a non-string supersedes', { ...signed, supersedes: 4 }],
    ])('rejects %s with a 400', async (_label, body) => {
      const response = await POST(respondRequest(body) as never, params('asset_1'));
      expect(response.status).toBe(400);
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('rejects a response missing a required field', async () => {
      const response = await POST(respondRequest({ ...signed, answers: {} }) as never, params('asset_1'));
      expect(response.status).toBe(400);
    });
  });

  describe('survey resolution', () => {
    it('404s when the survey cannot be resolved via either the public or owner-read path', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(null);
      readOwnerSurveyAssetMock.mockRejectedValue(new Error('not found'));

      const response = await POST(respondRequest(signed) as never, params('missing'));
      expect(response.status).toBe(404);
    });

    it('rejects a response to a non-published survey', async () => {
      readPublicSurveyAssetMock.mockResolvedValue({ ...doc, status: 'draft' });
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(403);
    });

    it('lets a private survey resolve for its owner through the owner read, then still refuses a non-published one', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(null);
      readOwnerSurveyAssetMock.mockResolvedValue({ content: { ...doc, status: 'closed' }, filename: 'f.json' });
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(403);
    });
  });

  describe('recording a response', () => {
    it("relays a respondent-signed attestation with the caller's own credentials: subject = owner, issuer = respondent", async () => {
      createAttestationMock.mockResolvedValue({ id: 'att_1' });

      const response = await POST(
        respondRequest({ ...signed, ticketId: 'tkt_1' }, { authorization: 'Bearer respondent-token', cookie: 'imajin_session=abc' }) as never,
        params('asset_1'),
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.response).toEqual({ id: 'att_1' });

      const [input, callerHeaders] = createAttestationMock.mock.calls[0];
      expect(input.issuerDid).toBe('did:imajin:respondent');
      expect(input.subjectDid).toBe('did:imajin:owner');
      expect(input.type).toBe('dykil/survey-response');
      expect(input.contextId).toBe('asset_1');
      expect(input.payload.provenance).toBe('respondent-signed');
      expect(input.payload.answers).toEqual({ q1: 'yes' });
      expect(input.payload.ticketId).toBe('tkt_1');
      expect(input.payload.docHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect('supersedes' in input.payload).toBe(false);
      expect(input.signature).toBe('sig');
      expect(input.issuedAt).toBe(1_700_000_000_000);
      expect(callerHeaders).toEqual({ authorization: 'Bearer respondent-token', cookie: 'imajin_session=abc' });
    });

    it('records the ticketId as the indexed ref', async () => {
      createAttestationMock.mockResolvedValue({ id: 'att_1' });
      await POST(respondRequest({ ...signed, ticketId: 'tkt_1' }) as never, params('asset_1'));
      expect(createAttestationMock.mock.calls[0][0].ref).toBe('tkt_1');
    });

    it('has no ref and a null ticketId when the response is not ticketed', async () => {
      createAttestationMock.mockResolvedValue({ id: 'att_1' });
      await POST(respondRequest(signed) as never, params('asset_1'));
      const [input] = createAttestationMock.mock.calls[0];
      expect(input.ref).toBeNull();
      expect(input.payload.ticketId).toBeNull();
    });

    it('surfaces a KernelAttestationError from the kernel as its own status', async () => {
      createAttestationMock.mockRejectedValue(new KernelAttestationError('Kernel rejected', 502, null));
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(502);
    });

    it('returns 500 when submission fails unexpectedly', async () => {
      createAttestationMock.mockRejectedValue(new Error('boom'));
      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      expect(response.status).toBe(500);
    });
  });

  describe('one response per respondent, edits by supersession', () => {
    it("looks up the respondent's own active responses by issuer, with their credentials", async () => {
      createAttestationMock.mockResolvedValue({ id: 'att_1' });

      await POST(respondRequest(signed, { authorization: 'Bearer respondent-token' }) as never, params('asset_1'));

      expect(listAllAttestationsMock).toHaveBeenCalledWith(
        { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: 'did:imajin:respondent' },
        { authorization: 'Bearer respondent-token' },
      );
    });

    it('refuses a second response with a 409 naming the response to edit, unless multipleResponses is on', async () => {
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);

      const response = await POST(respondRequest(signed) as never, params('asset_1'));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.responseId).toBe('att_first');
      expect(body.error).toContain('supersedes');
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('allows another response when the survey enables multipleResponses', async () => {
      readPublicSurveyAssetMock.mockResolvedValue({ ...doc, settings: { multipleResponses: true } });
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);
      createAttestationMock.mockResolvedValue({ id: 'att_second' });

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(201);
    });

    it('records an edit as payload.supersedes — inside the signed payload — naming the respondent\'s own response', async () => {
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);
      createAttestationMock.mockResolvedValue({ id: 'att_edit' });

      const response = await POST(respondRequest({ ...signed, supersedes: 'att_first' }) as never, params('asset_1'));

      expect(response.status).toBe(201);
      const [input] = createAttestationMock.mock.calls[0];
      expect(input.payload.supersedes).toBe('att_first');
    });

    it("404s a supersedes that is not one of the caller's own active responses to this survey", async () => {
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);

      const response = await POST(respondRequest({ ...signed, supersedes: 'att_someone_elses' }) as never, params('asset_1'));

      expect(response.status).toBe(404);
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('404s a supersedes when the respondent has no active response at all', async () => {
      const response = await POST(respondRequest({ ...signed, supersedes: 'att_x' }) as never, params('asset_1'));
      expect(response.status).toBe(404);
    });

    it("surfaces the kernel's own refusal of a supersession (e.g. a lost race) as its status", async () => {
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);
      createAttestationMock.mockRejectedValue(new KernelAttestationError('supersedes "att_first" is no longer an active one-sided attestation', 409, null));

      const response = await POST(respondRequest({ ...signed, supersedes: 'att_first' }) as never, params('asset_1'));

      expect(response.status).toBe(409);
    });

    it('also treats a response already recorded for the same ticket (by indexed ref) as a prior response', async () => {
      listAllAttestationsMock.mockImplementation(async (query: { ref?: string }) =>
        query.ref ? [{ id: 'att_tkt', type: 'dykil/survey-response-legacy-import', issuerDid: 'did:imajin:dykil-app' }] : [],
      );

      const response = await POST(respondRequest({ ...signed, ticketId: 'tkt_1' }) as never, params('asset_1'));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.responseId).toBe('att_tkt');
      expect(listAllAttestationsMock).toHaveBeenCalledWith(
        { subjectDid: 'did:imajin:owner', contextId: 'asset_1', ref: 'tkt_1' },
        {},
      );
    });

    it('counts a response found both by issuer and by ticket ref only once', async () => {
      readPublicSurveyAssetMock.mockResolvedValue({ ...doc, settings: { multipleResponses: true } });
      listAllAttestationsMock.mockResolvedValue([myResponse('att_first')]);
      createAttestationMock.mockResolvedValue({ id: 'att_edit' });

      const response = await POST(respondRequest({ ...signed, ticketId: 'tkt_1', supersedes: 'att_first' }) as never, params('asset_1'));

      expect(response.status).toBe(201);
    });
  });

  describe('ticket-holder gate', () => {
    const gated = { ...doc, settings: { eventId: 'event_1' } };

    it('does not consult the gate for a survey that is not ticket-scoped', async () => {
      createAttestationMock.mockResolvedValue({ id: 'att_1' });
      await POST(respondRequest(signed) as never, params('asset_1'));
      expect(hasAccessMock).not.toHaveBeenCalled();
    });

    it('gates a ticket-scoped survey through the boolean gate, never reading raw ticket rows', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(gated);
      hasAccessMock.mockResolvedValue(false);

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(403);
      expect(hasAccessMock).toHaveBeenCalledWith({ eventId: 'event_1', did: 'did:imajin:respondent' });
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('allows a ticket-scoped response once the gate says yes', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(gated);
      hasAccessMock.mockResolvedValue(true);
      createAttestationMock.mockResolvedValue({ id: 'att_2' });

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(201);
    });

    it('surfaces a 501 when the ticket gate is not configured', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(gated);
      hasAccessMock.mockRejectedValue(new TicketGateNotConfiguredError());

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(501);
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it.each([
      ['the events app refuses the token', new TicketGateError('Missing scope', 403)],
      ['the events app cannot find the event', new TicketGateError('Event not found', 404)],
      ['the gate token cannot be minted', new GateTokenUnavailableError('Kernel refused')],
    ])('fails closed with a 502 when %s', async (_label, failure) => {
      readPublicSurveyAssetMock.mockResolvedValue(gated);
      hasAccessMock.mockRejectedValue(failure);

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(502);
      expect(createAttestationMock).not.toHaveBeenCalled();
    });

    it('rethrows an unexpected ticket-gate failure to the outer catch', async () => {
      readPublicSurveyAssetMock.mockResolvedValue(gated);
      hasAccessMock.mockRejectedValue(new Error('gate unreachable'));

      const response = await POST(respondRequest(signed) as never, params('asset_1'));

      expect(response.status).toBe(500);
    });
  });
});
