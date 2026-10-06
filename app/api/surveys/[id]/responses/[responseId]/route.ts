import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_WRITE_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import { KernelAttestationError, revokeAttestation } from '@/lib/kernel/attestations';
import { forwardedIdentityHeaders } from '@/lib/kernel/forward';
import { listAllSurveyResponses } from '@/lib/responses';
import { loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string; responseId: string }>;
}

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * DELETE /api/surveys/:id/responses/:responseId — withdraw your own response.
 *
 * Relays to `POST {kernel}/api/attestations/{id}/revoke` (imajin-ai#2649),
 * which is issuer-only: the kernel stamps `revokedAt`, and the response drops
 * out of every default read, the owner's listing included. The attestation row
 * is not erased — it is the respondent's own signed record — only withdrawn.
 *
 * This app first confirms the id is one of the caller's own active responses
 * *to this survey* (so the URL can't be used to revoke an unrelated
 * attestation), then lets the kernel make the authoritative issuer check.
 * Kernel answers pass through: 403 not the issuer, 409 already revoked.
 */
export async function DELETE(request: NextRequest, props: RouteParams) {
  const { id, responseId } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const callerDid = authResult.auth.did;

  try {
    const doc = await loadSurveyDoc(id, request);
    if (!doc) {
      return errorResponse('Survey not found', 404, cors);
    }

    const headers = forwardedIdentityHeaders(request);
    const mine = await listAllSurveyResponses({ ownerDid: doc.ownerDid, surveyId: id, issuerDid: callerDid }, headers);
    if (!mine.some((attestation) => attestation.id === responseId)) {
      return errorResponse('Response not found', 404, cors);
    }

    const revoked = await revokeAttestation(responseId, headers);
    return jsonResponse({ revoked: true, id: revoked.id, revokedAt: revoked.revokedAt }, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to withdraw response');
    return errorResponse('Failed to withdraw response', 500, cors);
  }
}
