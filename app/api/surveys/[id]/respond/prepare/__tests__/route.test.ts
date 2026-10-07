import { beforeEach, describe, expect, it } from 'vitest';
import {
  asCaller,
  authenticateMock,
  publishedSurveyDocFixture,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';
import { KernelMediaError } from '@/lib/kernel/media';
import { canonicalResponsePayload } from '@/lib/response-attestation';
import { computeDocHash } from '@/lib/survey';

import { OPTIONS, POST } from '../route';

const doc = {
  ...publishedSurveyDocFixture,
  fields: { elements: [{ name: 'q1', type: 'text', title: 'Q1', isRequired: true }] },
};

function prepareRequest(body: unknown) {
  return new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond/prepare', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('OPTIONS /api/surveys/:id/respond/prepare', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1/respond/prepare') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('POST /api/surveys/:id/respond/prepare', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
  });

  it('requires dykil:write', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const response = await POST(prepareRequest({ answers: {} }) as never, params('asset_1'));
    expect(response.status).toBe(401);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:write'] });
  });

  it.each([
    ['a body that is not JSON', 'nope', 'Invalid JSON body'],
    ['no answers', {}, 'answers object is required'],
    ['array answers', { answers: [] }, 'answers object is required'],
    ['string answers', { answers: 'x' }, 'answers object is required'],
  ])('rejects %s with 400', async (_label, body, message) => {
    const response = await POST(prepareRequest(body) as never, params('asset_1'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(message);
  });

  it.each([
    ['an unknown survey', null, 404],
    ['a draft survey', { ...doc, status: 'draft' }, 403],
    ['a closed survey', { ...doc, status: 'closed' }, 403],
  ])('refuses %s', async (_label, survey, status) => {
    readPublicSurveyAssetMock.mockResolvedValue(survey);
    readOwnerSurveyAssetMock.mockResolvedValue(null);
    const response = await POST(prepareRequest({ answers: { q1: 'a' } }) as never, params('asset_1'));
    expect(response.status).toBe(status);
  });

  it('refuses answers that miss a required field, the same check /respond makes', async () => {
    const response = await POST(prepareRequest({ answers: {} }) as never, params('asset_1'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Field "Q1" is required');
  });

  it('returns exactly the bytes the kernel will verify, bound to the survey content hash', async () => {
    const response = await POST(prepareRequest({ answers: { q1: 'a' }, ticketId: 'tkt_1' }) as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payload).toEqual({
      provenance: 'respondent-signed',
      docHash: computeDocHash(doc as never),
      answers: { q1: 'a' },
      ticketId: 'tkt_1',
    });
    expect(typeof body.issuedAt).toBe('number');
    expect(body.canonical).toBe(
      canonicalResponsePayload({ surveyOwnerDid: 'did:imajin:owner', surveyAssetId: 'asset_1', payload: body.payload, issuedAt: body.issuedAt }),
    );
  });

  it.each([
    ['carries a supersedes id inside the signed payload', { supersedes: 'att_0' }, { supersedes: 'att_0' }],
    ['ignores an empty supersedes', { supersedes: '' }, {}],
    ['ignores a non-string supersedes', { supersedes: 5 }, {}],
  ])('%s', async (_label, extra, expected) => {
    const response = await POST(prepareRequest({ answers: { q1: 'a' }, ...extra }) as never, params('asset_1'));
    const { payload } = await response.json();
    expect(payload).toMatchObject({ ticketId: null, ...expected });
    expect('supersedes' in payload).toBe('supersedes' in expected);
  });

  it('passes a kernel media failure through', async () => {
    readPublicSurveyAssetMock.mockRejectedValue(new KernelMediaError('Media is down', 503, null));
    const response = await POST(prepareRequest({ answers: { q1: 'a' } }) as never, params('asset_1'));
    expect(response.status).toBe(503);
  });

  it('answers 500 for an unexpected failure', async () => {
    readPublicSurveyAssetMock.mockRejectedValue(new Error('boom'));
    const response = await POST(prepareRequest({ answers: { q1: 'a' } }) as never, params('asset_1'));
    expect(response.status).toBe(500);
  });
});
