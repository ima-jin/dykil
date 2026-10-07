import { vi } from 'vitest';

export interface FetchRoute {
  /** HTTP method; defaults to GET. */
  method?: string;
  /** Matched against `pathname + search` of the request URL. */
  match: string | RegExp;
  status?: number;
  body?: unknown;
  /** Reject the call (network failure) instead of answering. */
  fail?: boolean;
}

function matches(route: FetchRoute, method: string, target: string): boolean {
  if ((route.method ?? 'GET') !== method) return false;
  return typeof route.match === 'string' ? target === route.match : route.match.test(target);
}

/**
 * Install a routed `fetch` stub. The first route that matches `method` +
 * `pathname?search` answers; anything unmatched is a 599 so a test that forgot
 * a route fails loudly instead of hanging. Returns the mock for call inspection.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export function stubFetchRoutes(routes: FetchRoute[]) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((candidate) => matches(candidate, method, url.pathname + url.search));
    if (!route) return Promise.resolve(new Response(JSON.stringify({ error: `unrouted ${method} ${url.pathname}${url.search}` }), { status: 599 }));
    if (route.fail) return Promise.reject(new TypeError('network down'));
    return Promise.resolve(
      new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The `[method, pathname+search, parsed JSON body]` of every call made so far. */
export function callLog(mock: ReturnType<typeof stubFetchRoutes>): Array<[string, string, unknown]> {
  return mock.mock.calls.map(([input, init]) => {
    const url = new URL(requestUrl(input), 'http://localhost');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return [(init?.method ?? 'GET').toUpperCase(), url.pathname + url.search, body];
  });
}
