import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLog, stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';
import { EMPTY_DRAFT, loadDraft, saveDraft } from '../builder-api';
import { deleteSurvey, loadDashboard, surveyShareUrl } from '../dashboard-api';
import { loadHandleSurveys } from '../handle-api';
import { loadResults } from '../results-api';

afterEach(() => vi.unstubAllGlobals());

const NETWORK = { ok: false, status: 0, error: 'Network error — check your connection and try again' };

describe('loadDashboard', () => {
  const mine = (surveys: unknown[]): FetchRoute => ({ match: '/dykil/api/surveys/mine', body: { surveys } });
  const survey = (id: string) => ({ id, title: id, description: null, status: 'published', createdAt: 'c', updatedAt: 'u' });

  it('lists the caller’s surveys with their response counts', async () => {
    stubFetchRoutes([
      mine([survey('a'), survey('b'), survey('c')]),
      { match: '/dykil/api/surveys/a/responses', body: { responses: [], total: 3 } },
      { match: '/dykil/api/surveys/b/responses', body: { responses: [] } },
      { match: '/dykil/api/surveys/c/responses', status: 500, body: {} },
    ]);
    const result = await loadDashboard();
    expect(result).toMatchObject({ kind: 'ok' });
    expect(result.kind === 'ok' && result.surveys.map((s) => s.responseCount)).toEqual([3, 0, null]);
  });

  it('leaves a count null when its request fails outright', async () => {
    stubFetchRoutes([mine([survey('a')]), { match: '/dykil/api/surveys/a/responses', fail: true }]);
    const result = await loadDashboard();
    expect(result.kind === 'ok' && result.surveys[0].responseCount).toBeNull();
  });

  it.each<[string, FetchRoute, object]>([
    ['signed out', { match: '/dykil/api/surveys/mine', status: 401, body: {} }, { kind: 'signed-out' }],
    ['an API error', { match: '/dykil/api/surveys/mine', status: 500, body: { error: 'boom' } }, { kind: 'error', message: 'boom' }],
    ['a network failure', { match: '/dykil/api/surveys/mine', fail: true }, { kind: 'error', message: NETWORK.error }],
    ['no list in the body', { match: '/dykil/api/surveys/mine', body: {} }, { kind: 'ok', surveys: [] }],
  ])('handles %s', async (_label, route, expected) => {
    stubFetchRoutes([route]);
    expect(await loadDashboard()).toEqual(expected);
  });
});

describe('deleteSurvey / surveyShareUrl', () => {
  it.each<[string, FetchRoute, object]>([
    ['success', { method: 'DELETE', match: '/dykil/api/surveys/s1', body: { deleted: true } }, { ok: true, data: null }],
    ['an API error', { method: 'DELETE', match: '/dykil/api/surveys/s1', status: 403, body: { error: 'no' } }, { ok: false, status: 403, error: 'no' }],
    ['a network failure', { method: 'DELETE', match: '/dykil/api/surveys/s1', fail: true }, NETWORK],
  ])('delete: %s', async (_label, route, expected) => {
    stubFetchRoutes([route]);
    expect(await deleteSurvey('s1')).toEqual(expected);
  });

  it('builds the respondent link under the basePath', () => {
    expect(surveyShareUrl('https://dev-jin.imajin.ai', 'a b')).toBe('https://dev-jin.imajin.ai/dykil/survey/a%20b');
  });
});

describe('loadHandleSurveys', () => {
  it.each<[string, FetchRoute, object]>([
    ['surveys', { match: '/dykil/api/surveys/handle/ann', body: { surveys: [{ id: 's' }] } }, { kind: 'ok', surveys: [{ id: 's' }] }],
    ['no list', { match: '/dykil/api/surveys/handle/ann', body: {} }, { kind: 'ok', surveys: [] }],
    ['an unknown handle', { match: '/dykil/api/surveys/handle/ann', status: 404, body: {} }, { kind: 'not-found' }],
    ['a signed-out visitor', { match: '/dykil/api/surveys/handle/ann', status: 401, body: {} }, { kind: 'signed-out' }],
    ['an API error', { match: '/dykil/api/surveys/handle/ann', status: 500, body: { error: 'x' } }, { kind: 'error', message: 'x' }],
    ['a network failure', { match: '/dykil/api/surveys/handle/ann', fail: true }, { kind: 'error', message: NETWORK.error }],
  ])('handles %s', async (_label, route, expected) => {
    stubFetchRoutes([route]);
    expect(await loadHandleSurveys('ann')).toEqual(expected);
  });
});

describe('loadResults', () => {
  const survey = { id: 's1', title: 'T', description: null, status: 'published', fields: { pages: [{ elements: [{ type: 'text', name: 'a', title: 'A' }] }] } };
  const surveyRoute: FetchRoute = { match: '/dykil/api/surveys/s1', body: survey };
  const responses = (extra: Partial<FetchRoute>): FetchRoute => ({ match: '/dykil/api/surveys/s1/responses', ...extra });

  it('returns the questions (flattened) and every response', async () => {
    stubFetchRoutes([surveyRoute, responses({ body: { responses: [{ id: 'r1' }] } })]);
    const result = await loadResults('s1');
    expect(result).toMatchObject({ kind: 'ok', rows: [{ id: 'r1' }] });
    expect(result.kind === 'ok' && result.elements.map((e) => e.name)).toEqual(['a']);
  });

  it('treats a missing responses list as no responses', async () => {
    stubFetchRoutes([surveyRoute, responses({ body: {} })]);
    expect(await loadResults('s1')).toMatchObject({ kind: 'ok', rows: [] });
  });

  it.each<[string, FetchRoute[], object]>([
    ['an unknown survey', [{ match: '/dykil/api/surveys/s1', status: 404, body: {} }, responses({ status: 404, body: {} })], { kind: 'not-found' }],
    ['responses that 404', [surveyRoute, responses({ status: 404, body: {} })], { kind: 'not-found' }],
    ['signed out', [surveyRoute, responses({ status: 401, body: {} })], { kind: 'signed-out' }],
    ['someone else’s survey', [surveyRoute, responses({ status: 403, body: {} })], { kind: 'forbidden' }],
    ['a responses error', [surveyRoute, responses({ status: 500, body: { error: 'boom' } })], { kind: 'error', message: 'boom' }],
    ['a responses network failure', [surveyRoute, responses({ fail: true })], { kind: 'error', message: NETWORK.error }],
    ['a survey read error', [{ match: '/dykil/api/surveys/s1', status: 500, body: { error: 'down' } }, responses({ body: { responses: [] } })], { kind: 'error', message: 'down' }],
  ])('handles %s', async (_label, routes, expected) => {
    stubFetchRoutes(routes);
    expect(await loadResults('s1')).toEqual(expected);
  });
});

describe('builder api', () => {
  const stored = { id: 's1', title: 'T', description: null, status: 'published', fields: { pages: [{ elements: [{ type: 'text', name: 'a', title: 'A' }] }] } };

  it('loads a survey into a draft, flattening pages and defaulting optional parts', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s1', body: stored }]);
    expect(await loadDraft('s1')).toEqual({
      ok: true,
      data: { title: 'T', description: '', elements: [{ type: 'text', name: 'a', title: 'A' }], status: 'published', type: 'survey', settings: {} },
    });
  });

  it('keeps the survey type and settings it was stored with', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s1', body: { ...stored, description: 'D', type: 'pre-event', settings: { eventId: 'e1' }, fields: [] } }]);
    expect(await loadDraft('s1')).toMatchObject({ data: { description: 'D', type: 'pre-event', settings: { eventId: 'e1' } } });
  });

  it('passes a load failure through', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/s1', status: 404, body: {} }]);
    expect(await loadDraft('s1')).toMatchObject({ ok: false, status: 404 });
  });

  const draft = { ...EMPTY_DRAFT, title: 'T', description: 'D', elements: [{ type: 'text', name: 'a', title: 'A' }] };

  it.each([
    ['creates', null, false, 'POST', '/dykil/api/surveys', 'draft'],
    ['updates', 's 1', false, 'PUT', '/dykil/api/surveys/s%201', 'draft'],
    ['publishes', null, true, 'POST', '/dykil/api/surveys', 'published'],
  ])('%s', async (_label, editId, publish, method, path, status) => {
    const mock = stubFetchRoutes([{ method, match: path, status: 201, body: { id: 'new' } }]);
    expect(await saveDraft(editId, draft, publish)).toEqual({ ok: true, data: { id: 'new' } });
    expect(callLog(mock)[0]).toEqual([
      method,
      path,
      { title: 'T', description: 'D', fields: { elements: draft.elements }, type: 'survey', status, settings: {} },
    ]);
  });

  it.each([
    ['trims and keeps an event id', { eventId: ' e1 ', multipleResponses: true }, { eventId: 'e1', multipleResponses: true }],
    ['drops a blank event id', { eventId: '  ' }, {}],
  ])('settings: %s', async (_label, settings, expected) => {
    const mock = stubFetchRoutes([{ method: 'POST', match: '/dykil/api/surveys', body: {} }]);
    await saveDraft(null, { ...draft, settings }, false);
    expect((callLog(mock)[0][2] as { settings: unknown }).settings).toEqual(expected);
  });

  it.each<[string, FetchRoute, object]>([
    ['an API error', { method: 'POST', match: '/dykil/api/surveys', status: 400, body: { error: 'bad' } }, { ok: false, status: 400, error: 'bad' }],
    ['a network failure', { method: 'POST', match: '/dykil/api/surveys', fail: true }, NETWORK],
    ['an empty success body', { method: 'POST', match: '/dykil/api/surveys', status: 201 }, { ok: true, data: {} }],
  ])('save: %s', async (_label, route, expected) => {
    stubFetchRoutes([route]);
    expect(await saveDraft(null, draft, false)).toEqual(expected);
  });
});
