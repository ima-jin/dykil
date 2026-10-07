import { withBasePath } from '@/lib/base-path';

/**
 * Browser-side fetch against this app's own `/api/*` routes. Next prefixes
 * `<Link>` with the basePath but not raw `fetch()`, so every call goes through
 * `withBasePath`; cookies ride along because the kernel session is a shared
 * cookie (the routes authenticate it via `authenticate()`).
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(withBasePath(path), { credentials: 'include', ...init });
}

/** Parse a JSON body, or null when there is none / it is malformed. */
export async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The `error` string of a failed API response, or a fallback. */
export async function readError(response: Response, fallback: string): Promise<string> {
  const body = await readJson<{ error?: string }>(response);
  return body?.error ?? fallback;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
