import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { fetchExistingResponse, fetchGate, fetchSurvey, prepareResponse, submitResponse } from '../survey-api';

afterEach(() => vi.unstubAllGlobals());

describe('fetchSurvey', () => {
  it('returns the survey document', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s%201', body: { id: 's 1', title: 'T' } }]);
    expect(await fetchSurvey('s 1')).toEqual({ ok: true, data: { id: 's 1', title: 'T' } });
  });

  it.each([
    ['an API error', { status: 404, body: { error: 'Survey not found' } }, { ok: false, status: 404, error: 'Survey not found' }],
    ['an error without a body message', { status: 500, body: {} }, { ok: false, status: 500, error: 'Survey not found' }],
    ['a network failure', { fail: true }, { ok: false, status: 0, error: 'Network error — check your connection and try again' }],
  ])('maps %s', async (_label, route, expected) => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s1', ...route }]);
    expect(await fetchSurvey('s1')).toEqual(expected);
  });

  it('treats a 200 with an unreadable body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    expect(await fetchSurvey('s1')).toEqual({ ok: false, status: 200, error: 'Survey not found' });
  });
});

describe('fetchGate', () => {
  it.each([
    [{ body: { gated: true, allowed: false } }, { ok: true, data: { gated: true, allowed: false } }],
    [{ status: 501, body: { error: 'not configured' } }, { ok: false, status: 501, error: 'not configured' }],
  ])('maps %j', async (route, expected) => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s1/gate', ...route }]);
    expect(await fetchGate('s1')).toEqual(expected);
  });
});

describe('fetchExistingResponse', () => {
  it.each([
    ['without a ticket', null, '/dykil/api/surveys/s1/responses/check?include=answers'],
    ['with a ticket', 't 1', '/dykil/api/surveys/s1/responses/check?include=answers&ticketId=t+1'],
  ])('asks for the answers %s', async (_label, ticketId, target) => {
    const mock = stubFetchRoutes([{ match: target, body: { completed: false } }]);
    expect(await fetchExistingResponse('s1', ticketId)).toEqual({ ok: true, data: { completed: false } });
    expect(callLog(mock)[0][1]).toBe(target);
  });
});

describe('prepareResponse / submitResponse', () => {
  it.each([
    ['only the answers', { answers: { q: 1 }, ticketId: null, supersedes: null }, { answers: { q: 1 } }],
    [
      'a ticket and a superseded response',
      { answers: { q: 1 }, ticketId: 't1', supersedes: 'r0' },
      { answers: { q: 1 }, ticketId: 't1', supersedes: 'r0' },
    ],
  ])('sends %s', async (_label, input, expectedBody) => {
    const mock = stubFetchRoutes([
      { method: 'POST', match: '/dykil/api/surveys/s1/respond/prepare', body: { canonical: 'c', issuedAt: 5 } },
      { method: 'POST', match: '/dykil/api/surveys/s1/respond', body: { response: { id: 'r1' } } },
    ]);
    expect(await prepareResponse('s1', input)).toEqual({ ok: true, data: { canonical: 'c', issuedAt: 5 } });
    expect(await submitResponse('s1', { ...input, issuedAt: 5, signature: 'ab' })).toEqual({ ok: true, data: { response: { id: 'r1' } } });
    expect(callLog(mock)).toEqual([
      ['POST', '/dykil/api/surveys/s1/respond/prepare', expectedBody],
      ['POST', '/dykil/api/surveys/s1/respond', { ...expectedBody, issuedAt: 5, signature: 'ab' }],
    ]);
  });

  it('surfaces a refused submission', async () => {
    stubFetchRoutes([{ method: 'POST', match: '/dykil/api/surveys/s1/respond', status: 400, body: { error: 'Invalid signature' } }]);
    expect(await submitResponse('s1', { answers: {}, ticketId: null, supersedes: null, issuedAt: 1, signature: 'x' })).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid signature',
    });
  });
});
