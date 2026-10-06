import { createLogger } from '@ima-jin/logger';
import { NextResponse } from 'next/server';
import {
  KernelMediaError,
  listMySurveyAssets,
  readOwnerSurveyAsset,
  readPublicSurveyAsset,
  setSurveyAssetAccess,
  updateSurveyAsset,
} from '@/lib/kernel/media';
import { errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc, type SurveyDoc } from '@/lib/survey';

const log = createLogger('dykil');

export type OwnedSurveyResult = { survey: SurveyDoc } | { response: NextResponse };

/**
 * Load a survey via the authenticated owner-read path and confirm the given
 * DID owns it. Shared by the mutating routes on /api/surveys/:id (PUT,
 * DELETE), which both need the exact same "not found" vs "not yours"
 * distinction before mutating — see FINDINGS.md gap #2393 for why the
 * owner-read itself can only be attempted with a forwarded session/cookie.
 */
export async function requireOwnedSurvey(
  id: string,
  did: string,
  request: Request,
  cors: Record<string, string>,
  notAuthorizedMessage: string,
): Promise<OwnedSurveyResult> {
  const existing = await readOwnerSurveyAsset(id, request);
  if (!existing || !isSurveyDoc(existing.content)) {
    return { response: errorResponse('Survey not found', 404, cors) };
  }
  if (existing.content.ownerDid !== did) {
    return { response: errorResponse(notAuthorizedMessage, 403, cors) };
  }
  return { survey: existing.content };
}

/**
 * Shared catch-all for the /api/surveys/:id routes: surface a
 * `KernelMediaError`'s own status/message untouched, log + 500 otherwise.
 * `fallbackMessage` is used both as the log context and the 500 body, since
 * every caller here already treated those as the same string.
 */
export function handleSurveyRouteError(error: unknown, cors: Record<string, string>, fallbackMessage: string): NextResponse {
  if (error instanceof KernelMediaError) {
    return errorResponse(error.message, error.status, cors);
  }
  log.error({ err: String(error) }, fallbackMessage);
  return errorResponse(fallbackMessage, 500, cors);
}

/**
 * Resolve a survey document the way every respondent-facing route needs it:
 * the public asset-serving read first (a published survey is `public`), then
 * — for a draft or closed survey, which is genuinely `private` — the
 * caller's own owner read. Null when neither yields a survey document.
 */
export async function loadSurveyDoc(id: string, request: Request): Promise<SurveyDoc | null> {
  const publicContent = await readPublicSurveyAsset(id);
  if (isSurveyDoc(publicContent)) return publicContent;
  const owned = await readOwnerSurveyAsset(id, request).catch(() => null);
  if (owned && isSurveyDoc(owned.content)) return owned.content;
  return null;
}

/**
 * Persist an edited survey document, moving its `.fair` access level with its
 * status (`PATCH /media/api/assets/{id}/access`): only a `published` survey
 * is `public`. The order keeps the document from ever being public longer
 * than its status says — going private flips access first, going public
 * flips it last, after the new content is in place.
 */
export async function persistSurveyUpdate(id: string, previous: SurveyDoc, updated: SurveyDoc, request: Request): Promise<void> {
  const wasPublic = previous.status === 'published';
  const isPublic = updated.status === 'published';
  if (wasPublic && !isPublic) {
    await setSurveyAssetAccess(id, 'private', request);
  }
  await updateSurveyAsset(id, JSON.stringify(updated), request);
  if (!wasPublic && isPublic) {
    await setSurveyAssetAccess(id, 'public', request);
  }
}

/**
 * List the caller's own survey documents — shared by `GET /api/surveys` and
 * `GET /api/surveys/mine`. Always the caller's own DID (the kernel scopes the
 * asset list to the caller); there is no `dids=` parameter, so one user can
 * never list another's drafts.
 */
export async function listOwnSurveys(request: Request): Promise<NextResponse> {
  try {
    const assets = await listMySurveyAssets(request);
    const surveys = await Promise.all(
      assets.map(async (asset) => {
        const read = await readOwnerSurveyAsset(asset.id, request);
        if (!read || !isSurveyDoc(read.content)) return null;
        return { id: asset.id, ...read.content };
      }),
    );
    return jsonResponse({ surveys: surveys.filter((survey) => survey !== null) });
  } catch (error) {
    if (error instanceof KernelMediaError) {
      return errorResponse(error.message, error.status);
    }
    log.error({ err: String(error) }, 'Failed to list surveys');
    return errorResponse('Failed to fetch surveys', 500);
  }
}
