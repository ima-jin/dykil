import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import { enforceTicketGate, loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/:id/gate — may the caller respond to this survey?
 *
 * `{ gated: false, allowed: true }` for an ungated survey. For a ticket-gated
 * one (`settings.eventId`) it asks the events app's boolean gate about the
 * caller's own DID and answers `{ gated: true, allowed }` — never a ticket
 * row. An unconfigured or unreachable gate is surfaced as 501 / 502 by the same
 * code `/respond` uses, so the form can say so before the respondent fills it
 * in instead of after. Authenticated callers only.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }

  try {
    const doc = await loadSurveyDoc(id, request);
    if (!doc) return errorResponse('Survey not found', 404, cors);
    if (!doc.settings.eventId) return jsonResponse({ gated: false, allowed: true }, 200, cors);

    const failure = await enforceTicketGate(doc, authResult.auth.did, cors);
    if (!failure) return jsonResponse({ gated: true, allowed: true }, 200, cors);
    if (failure.status === 403) return jsonResponse({ gated: true, allowed: false }, 200, cors);
    return failure;
  } catch (error) {
    if (error instanceof KernelMediaError) return errorResponse(error.message, error.status, cors);
    log.error({ err: String(error) }, 'Failed to evaluate survey gate');
    return errorResponse('Failed to evaluate survey gate', 500, cors);
  }
}
