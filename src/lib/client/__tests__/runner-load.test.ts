import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLog, stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';
import { loadInitialView } from '../runner-load';

afterEach(() => vi.unstubAllGlobals());

const SURVEY = { id: 's1', title: 'T', description: null, fields: { elements: [] }, status: 'published' };
const survey: FetchRoute = { match: '/dykil/api/surveys/s1', body: SURVEY };
const gateOpen: FetchRoute = { match: '/dykil/api/surveys/s1/gate', body: { gated: false, allowed: true } };
const noResponse: FetchRoute = { match: /\/responses\/check/, body: { completed: false } };

describe('loadInitialView', () => {
  it.each<[string, FetchRoute[], boolean, object]>([
    ['an unknown survey', [{ match: '/dykil/api/surveys/s1', status: 404, body: { error: 'x' } }], true, { kind: 'not-found' }],
    ['a survey read failure', [{ match: '/dykil/api/surveys/s1', status: 500, body: { error: 'boom' } }], true, { kind: 'error', message: 'boom' }],
    ['a draft survey', [{ match: '/dykil/api/surveys/s1', body: { ...SURVEY, status: 'draft' } }], true, { kind: 'unavailable', status: 'draft' }],
    ['a closed survey', [{ match: '/dykil/api/surveys/s1', body: { ...SURVEY, status: 'closed' } }], false, { kind: 'unavailable', status: 'closed' }],
    ['a signed-out visitor', [survey], false, { kind: 'sign-in', survey: SURVEY }],
    [
      'a non-holder of a gated survey',
      [survey, { match: '/dykil/api/surveys/s1/gate', body: { gated: true, allowed: false } }],
      true,
      { kind: 'ticket-required', survey: SURVEY },
    ],
    [
      'an unavailable gate',
      [survey, { match: '/dykil/api/surveys/s1/gate', status: 502, body: { error: 'The ticket gate is unavailable' } }],
      true,
      { kind: 'error', message: 'The ticket gate is unavailable' },
    ],
    [
      'an earlier response',
      [survey, gateOpen, { match: /\/responses\/check/, body: { completed: true, responseId: 'r1', answers: { q: 'a' } } }],
      true,
      { kind: 'submitted', survey: SURVEY, answers: { q: 'a' }, responseId: 'r1' },
    ],
    [
      'an earlier response without an id',
      [survey, gateOpen, { match: /\/responses\/check/, body: { completed: true, answers: { q: 'a' } } }],
      true,
      { kind: 'submitted', survey: SURVEY, answers: { q: 'a' }, responseId: null },
    ],
    ['no earlier response', [survey, gateOpen, noResponse], true, { kind: 'answering', survey: SURVEY }],
    [
      'a response lookup that fails (non-fatal)',
      [survey, gateOpen, { match: /\/responses\/check/, status: 500, body: {} }],
      true,
      { kind: 'answering', survey: SURVEY },
    ],
    [
      'a completed lookup with no answers',
      [survey, gateOpen, { match: /\/responses\/check/, body: { completed: true } }],
      true,
      { kind: 'answering', survey: SURVEY },
    ],
  ])('lands on the right view for %s', async (_label, routes, signedIn, expected) => {
    stubFetchRoutes(routes);
    expect(await loadInitialView('s1', null, signedIn)).toEqual(expected);
  });

  it('does not ask the gate or the response store for a signed-out visitor', async () => {
    const mock = stubFetchRoutes([survey]);
    await loadInitialView('s1', null, false);
    expect(callLog(mock).map(([, path]) => path)).toEqual(['/dykil/api/surveys/s1']);
  });

  it('passes the ticket id through to the response lookup', async () => {
    const mock = stubFetchRoutes([survey, gateOpen, noResponse]);
    await loadInitialView('s1', 't9', true);
    expect(callLog(mock).at(-1)?.[1]).toContain('ticketId=t9');
  });
});
