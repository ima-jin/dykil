import { mediaServiceUrl } from '@/lib/env';

export interface KernelAsset {
  id: string;
  ownerDid: string;
  filename: string;
  mimeType: string;
  size: number;
  hash: string;
  fairManifest: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string | null;
}

export class KernelMediaError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'KernelMediaError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Forward the inbound caller's own identity to the kernel media service.
 *
 * The media asset write routes (`POST /api/assets`, `PUT /api/assets/{id}/content`,
 * `DELETE /api/assets/{id}`) and the authenticated read route
 * (`GET /api/assets/{id}/content`) all gate on `@imajin/auth`'s `requireAuth`,
 * which only understands the shared kernel session cookie or a legacy
 * personal-access-token Bearer — NOT the scoped app-token this app verifies
 * its own inbound requests with (see FINDINGS.md gap #2393). Forwarding both
 * headers is the closest this app can get to "act as the caller" until that
 * migration lands; a scoped-app-token-only caller will get a 401 back from
 * the kernel, which this app surfaces rather than masks.
 */
function forwardedIdentityHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return headers;
}

async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Kernel media call failed (${response.status})`;
    throw new KernelMediaError(message, response.status, body);
  }
  return body;
}

/**
 * Create a survey-definition document as a media asset owned by the caller's
 * DID. The kernel signs the asset's `.fair` manifest on the owner's behalf
 * (`ContentSigner`/`signFairAsNode`) — that delegated signature is what makes
 * this a "signed document" today, ahead of user-held keys (#734).
 */
export async function createSurveyAsset(params: {
  request: Request;
  filename: string;
  content: string;
  access: 'public' | 'private';
}): Promise<KernelAsset> {
  const form = new FormData();
  form.set('file', new Blob([params.content], { type: 'application/json' }), params.filename);
  form.set('filename', params.filename);
  form.set('context', JSON.stringify({ app: 'dykil', feature: 'survey', access: params.access }));

  const response = await fetch(`${mediaServiceUrl()}/api/assets`, {
    method: 'POST',
    headers: forwardedIdentityHeaders(params.request),
    body: form,
  });
  return (await parseJsonOrThrow(response)) as KernelAsset;
}

/**
 * Read a survey document's content via the *public* asset-serving endpoint
 * (`GET /api/assets/{id}`, no security requirement in api-spec/media.yaml) —
 * this is deliberately NOT `/api/assets/{id}/content`, whose GET
 * unconditionally requires `requireAuth` even for a `public`-access asset
 * (see FINDINGS.md gap #2393). Works for any published (public-access)
 * survey with zero caller identity, matching the original app's anonymous
 * read behavior for published surveys.
 */
export async function readPublicSurveyAsset(id: string): Promise<unknown | null> {
  const response = await fetch(`${mediaServiceUrl()}/api/assets/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) {
    throw new KernelMediaError(`Failed to read asset ${id}`, response.status, null);
  }
  return response.json();
}

/**
 * Read a survey document's content as its owner (draft/unpublished access).
 * Requires the caller's own session/identity to be forwarded — see
 * `forwardedIdentityHeaders` above and FINDINGS.md gap #2393.
 */
export async function readOwnerSurveyAsset(id: string, request: Request): Promise<{ content: unknown; filename: string } | null> {
  const response = await fetch(`${mediaServiceUrl()}/api/assets/${encodeURIComponent(id)}/content`, {
    headers: forwardedIdentityHeaders(request),
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  return (await parseJsonOrThrow(response)) as { content: unknown; filename: string };
}

export async function updateSurveyAsset(id: string, content: string, request: Request): Promise<{ ok: true }> {
  const response = await fetch(`${mediaServiceUrl()}/api/assets/${encodeURIComponent(id)}/content`, {
    method: 'PUT',
    headers: { ...forwardedIdentityHeaders(request), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return (await parseJsonOrThrow(response)) as { ok: true };
}

export async function deleteSurveyAsset(id: string, request: Request): Promise<{ ok: boolean }> {
  const response = await fetch(`${mediaServiceUrl()}/api/assets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: forwardedIdentityHeaders(request),
  });
  return (await parseJsonOrThrow(response)) as { ok: boolean };
}

/**
 * List the caller's own survey documents. The public media list API has no
 * app/feature-context filter (only a mimeType prefix and a filename
 * substring search), so this leans on a `dykil-survey-` filename convention
 * — see `src/lib/survey.ts`'s `SURVEY_FILENAME_PREFIX`.
 */
export async function listMySurveyAssets(request: Request): Promise<KernelAsset[]> {
  const url = new URL(`${mediaServiceUrl()}/api/assets`);
  url.searchParams.set('type', 'application');
  url.searchParams.set('search', 'dykil-survey-');
  url.searchParams.set('limit', '200');
  const response = await fetch(url, { headers: forwardedIdentityHeaders(request), cache: 'no-store' });
  const body = (await parseJsonOrThrow(response)) as { assets: KernelAsset[] };
  return body.assets;
}
