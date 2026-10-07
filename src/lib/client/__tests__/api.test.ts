import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { apiFetch, jsonInit, readError, readJson } from '../api';
import { signInUrl } from '../auth';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiFetch', () => {
  it('prefixes the basePath and sends credentials', async () => {
    const mock = stubFetchRoutes([{ match: '/dykil/api/session' }]);
    await apiFetch('/api/session');
    expect(mock).toHaveBeenCalledWith('/dykil/api/session', { credentials: 'include' });
  });

  it('lets the caller add request options', async () => {
    const mock = stubFetchRoutes([{ method: 'DELETE', match: '/dykil/api/surveys/s1' }]);
    await apiFetch('/api/surveys/s1', { method: 'DELETE' });
    expect(callLog(mock)).toEqual([['DELETE', '/dykil/api/surveys/s1', undefined]]);
  });
});

describe('readJson / readError', () => {
  it.each([
    ['a JSON body', new Response('{"a":1}'), { a: 1 }],
    ['an empty body', new Response(''), null],
    ['a non-JSON body', new Response('<html>'), null],
  ])('readJson of %s', async (_label, response, expected) => {
    expect(await readJson(response)).toEqual(expected);
  });

  it.each([
    ['the body error', new Response('{"error":"nope"}'), 'nope'],
    ['the fallback when the body has none', new Response('{}'), 'fallback'],
    ['the fallback when the body is not JSON', new Response('oops'), 'fallback'],
  ])('readError uses %s', async (_label, response, expected) => {
    expect(await readError(response, 'fallback')).toBe(expected);
  });
});

describe('jsonInit', () => {
  it('builds a JSON request', () => {
    expect(jsonInit('PUT', { a: 1 })).toEqual({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
});

describe('signInUrl', () => {
  it.each([
    ['https://dev-jin.imajin.ai', 'https://dev-jin.imajin.ai/auth/login?next=https%3A%2F%2Fx.test%2Fdykil%2Fdashboard'],
    ['', '/auth/login?next=https%3A%2F%2Fx.test%2Fdykil%2Fdashboard'],
  ])('with kernel origin %j', (origin, expected) => {
    vi.stubEnv('NEXT_PUBLIC_IMAJIN_AUTH_URL', origin);
    expect(signInUrl('https://x.test/dykil/dashboard')).toBe(expected);
  });
});
