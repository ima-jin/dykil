import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { readPublicSurveyAsset, readOwnerSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
import { listAttestations, KernelAttestationError } from '@/lib/kernel/attestations';
import { responseAttestationType, legacyImportAttestationType } from '@/lib/env';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { isSurveyDoc } from '@/lib/survey';

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
 * Two modes:
 *  - Authenticated (session/app-token) — checked by `issuer_did` on the
 *    attestation, an efficient server-side filter the public attestations
 *    API supports directly.
 *  - `?ticketId=` — ticket-scoped check (e.g. one response per ticket for a
 *    ticket-gated survey). This intentionally replaces the original
 *    `responses/by-ticket/[ticketId]` route: it answers "has this ticket
 *    responded", never "give me the ticket-scoped row" — the owner-only
 *    listing (`GET /responses`) is the only place raw response rows are
 *    returned, and even that never touches ticket data itself (Ryan's
 *    ruling — see src/lib/ticket-gate.ts).
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);
  const ticketId = request.nextUrl.searchParams.get('ticketId');
  const includeAnswers = request.nextUrl.searchParams.get('include') === 'answers';

  try {
    const publicContent = await readPublicSurveyAsset(id);
    const doc = publicContent && isSurveyDoc(publicContent) ? publicContent : null;
    const owned = doc ?? (await readOwnerSurveyAsset(id, request).catch(() => null))?.content;
    if (!owned || !isSurveyDoc(owned)) {
      return errorResponse('Survey not found', 404, cors);
    }

    const authResult = await authenticate(request);
    const callerDid = 'auth' in authResult ? authResult.auth.did : null;

    if (!callerDid && !ticketId) {
      return jsonResponse({ completed: false }, 200, cors);
    }

    const [respondentSigned, legacyImported] = await Promise.all([
      listAttestations({
        subjectDid: owned.ownerDid,
        type: responseAttestationType(),
        issuerDid: callerDid ?? undefined,
      }),
      ticketId
        ? listAttestations({ subjectDid: owned.ownerDid, type: legacyImportAttestationType() })
        : Promise.resolve([]),
    ]);

    const candidates = [...respondentSigned, ...legacyImported].filter((attestation) => attestation.contextId === id);
    const match = candidates.find((attestation) => {
      if (ticketId) return attestation.payload?.ticketId === ticketId;
      return attestation.issuerDid === callerDid;
    });

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
