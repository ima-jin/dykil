import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_READ_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import { KernelAttestationError } from '@/lib/kernel/attestations';
import { forwardedIdentityHeaders } from '@/lib/kernel/forward';
import { listAllSurveyResponses } from '@/lib/responses';
import { loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/surveys/:id/responses/check — has the caller already responded?
 *
 * Authenticated callers only (the original's unauthenticated `?did=` probe
 * was deliberately not carried over — it let anyone test whether a DID had
 * responded). Two modes:
 *  - default — the caller's own active response, by `issuer_did`.
 *  - `?ticketId=` — a ticket-scoped check (e.g. one response per ticket),
 *    by the indexed `ref` the response was recorded with (imajin-ai#2534)
 *    rather than by scanning payloads. It answers "has this ticket
 *    responded", never "give me the ticket row"; response rows are
 *    `disclosure_scope`-gated, so a caller only ever matches their own
 *    responses (the survey owner matches any).
 *
 * `?include=answers` adds the stored answers to a match.
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);
  const { searchParams } = new URL(request.url);
  const ticketId = searchParams.get('ticketId');
  const includeAnswers = searchParams.get('include') === 'answers';

  const authResult = await authenticate(request, { requireScopes: [DYKIL_READ_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const callerDid = authResult.auth.did;

  try {
    const doc = await loadSurveyDoc(id, request);
    if (!doc) {
      return errorResponse('Survey not found', 404, cors);
    }

    const candidates = await listAllSurveyResponses(
      {
        ownerDid: doc.ownerDid,
        surveyId: id,
        issuerDid: ticketId ? undefined : callerDid,
        ref: ticketId ?? undefined,
      },
      forwardedIdentityHeaders(request),
    );

    const match = candidates.find((attestation) =>
      ticketId ? attestation.payload?.ticketId === ticketId : attestation.issuerDid === callerDid,
    );
    if (!match) {
      return jsonResponse({ completed: false }, 200, cors);
    }

    const result: { completed: boolean; responseId?: string; answers?: unknown } = { completed: true, responseId: match.id };
    if (includeAnswers) {
      result.answers = match.payload?.answers ?? null;
    }
    return jsonResponse(result, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to check survey response');
    return errorResponse('Failed to check response', 500, cors);
  }
}
