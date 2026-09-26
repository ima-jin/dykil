import { createLogger } from '@ima-jin/logger';
import { NextResponse } from 'next/server';
import { KernelMediaError, readOwnerSurveyAsset } from '@/lib/kernel/media';
import { errorResponse } from '@/lib/http';
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
