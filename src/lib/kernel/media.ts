import { DYKIL_MEDIA_CONTEXT_APP, DYKIL_MEDIA_CONTEXT_FEATURE, mediaServiceUrl } from '@/lib/env';
import { collectPages } from '@/lib/async/paginate';
import { forwardedIdentityHeaders } from '@/lib/kernel/forward';

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
  form.set(
    'context',
    JSON.stringify({ app: DYKIL_MEDIA_CONTEXT_APP, feature: DYKIL_MEDIA_CONTEXT_FEATURE, access: params.access }),
  );

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
 * this is deliberately NOT `/api/assets/{id}/content`, whose GET requires an
 * authenticated caller even for a `public`-access asset. Works for any
 * published survey (its asset is `public`) with zero caller identity, matching
 * the original app's anonymous read behavior for published surveys. A draft or
 * closed survey's asset is `private`, so this returns null for it.
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
 * `forwardedIdentityHeaders` (src/lib/kernel/forward.ts).
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

export type SurveyAssetAccess = 'public' | 'private';

/**
 * Flip a survey document's `.fair` access level — the draft/published
 * transition. `PATCH /media/api/assets/{id}/access` (owner only; the kernel
 * re-signs and republishes the manifest). A draft is therefore genuinely
 * `private`, not merely unlisted.
 */
export async function setSurveyAssetAccess(id: string, access: SurveyAssetAccess, request: Request): Promise<KernelAsset> {
  const response = await fetch(`${mediaServiceUrl()}/api/assets/${encodeURIComponent(id)}/access`, {
    method: 'PATCH',
    headers: { ...forwardedIdentityHeaders(request), 'Content-Type': 'application/json' },
    body: JSON.stringify({ access }),
  });
  return (await parseJsonOrThrow(response)) as KernelAsset;
}

const SURVEY_LIST_PAGE_SIZE = 200;
const SURVEY_LIST_MAX_PAGES = 25;

/**
 * List the caller's own survey documents:
 * `GET /media/api/assets?context_app=dykil&context_feature=survey` — an exact
 * match on the upload context each survey asset was stored under (the
 * `media:read` app-token path plus the context filters, imajin-ai#2648), so
 * no filename convention is involved. Pages by `offset` until a short page.
 */
export async function listMySurveyAssets(request: Request): Promise<KernelAsset[]> {
  return collectPages<KernelAsset, number>(async (start = 0) => {
    const url = new URL(`${mediaServiceUrl()}/api/assets`);
    url.searchParams.set('context_app', DYKIL_MEDIA_CONTEXT_APP);
    url.searchParams.set('context_feature', DYKIL_MEDIA_CONTEXT_FEATURE);
    url.searchParams.set('limit', String(SURVEY_LIST_PAGE_SIZE));
    url.searchParams.set('offset', String(start));
    const response = await fetch(url, { headers: forwardedIdentityHeaders(request), cache: 'no-store' });
    const body = (await parseJsonOrThrow(response)) as { assets: KernelAsset[] };
    const full = body.assets.length >= SURVEY_LIST_PAGE_SIZE;
    return { items: body.assets, next: full ? start + SURVEY_LIST_PAGE_SIZE : undefined };
  }, SURVEY_LIST_MAX_PAGES);
}
