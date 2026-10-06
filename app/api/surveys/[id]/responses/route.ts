import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import { KernelAttestationError } from '@/lib/kernel/attestations';
import { forwardedIdentityHeaders } from '@/lib/kernel/forward';
import { listAllSurveyResponses, listSurveyResponsesPage } from '@/lib/responses';
import { loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';

const log = createLogger('dykil');

/** Largest page a caller may ask for (the kernel caps a page at 100). */
const MAX_PAGE_SIZE = 100;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/:id/responses — a survey's responses (owner only).
 *
 * Sourced from `GET {kernel}/api/attestations?subject_did=<owner>&context_id=<survey>`
 * (the indexed `context_id` filter, imajin-ai#2396), with the caller's own
 * credentials forwarded — response types are `disclosure_scope`-gated, so the
 * owner (the attestations' subject) sees them and nobody else does.
 *
 * Two modes, both cursor-paged by the kernel (imajin-ai#2533):
 *  - no `limit` / `cursor`: the owner's full export — every page is followed
 *    until the kernel reports no more, and `{ responses, total }` is returned.
 *  - `?limit=<n>[&cursor=<nextCursor>]`: one page, `{ responses, nextCursor }`,
 *    where `nextCursor` is null on the last page.
 *
 * Revoked (withdrawn) and superseded (edited) responses are not listed; each
 * respondent's current response is.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const did = authResult.auth.did;

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const cursor = searchParams.get('cursor');
  const limit = limitParam === null ? null : Number.parseInt(limitParam, 10);
  if (limit !== null && (Number.isNaN(limit) || limit < 1)) {
    return errorResponse('limit must be a positive integer', 400, cors);
  }

  try {
    const doc = await loadSurveyDoc(id, request);
    if (!doc) {
      return errorResponse('Survey not found', 404, cors);
    }
    if (doc.ownerDid !== did) {
      return errorResponse('Not authorized to view responses', 403, cors);
    }

    const query = { ownerDid: doc.ownerDid, surveyId: id };
    const headers = forwardedIdentityHeaders(request);

    if (limit === null && cursor === null) {
      const responses = await listAllSurveyResponses(query, headers);
      return jsonResponse({ responses, total: responses.length }, 200, cors);
    }

    const page = await listSurveyResponsesPage(
      { ...query, before: cursor ?? undefined, limit: Math.min(limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE) },
      headers,
    );
    return jsonResponse({ responses: page.rows, nextCursor: page.nextCursor }, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to fetch responses');
    return errorResponse('Failed to fetch responses', 500, cors);
  }
}
