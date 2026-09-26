import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { readPublicSurveyAsset, readOwnerSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
import { createAttestation, KernelAttestationError } from '@/lib/kernel/attestations';
import { buildResponseAttestationInput } from '@/lib/response-attestation';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { computeDocHash, findMissingRequiredField, isSurveyDoc } from '@/lib/survey';
import { defaultTicketGate, TicketGateNotConfiguredError } from '@/lib/ticket-gate';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

async function resolveSurveyDoc(id: string, request: NextRequest) {
  const publicContent = await readPublicSurveyAsset(id);
  if (publicContent && isSurveyDoc(publicContent)) return publicContent;
  const owned = await readOwnerSurveyAsset(id, request).catch(() => null);
  if (owned && isSurveyDoc(owned.content)) return owned.content;
  return null;
}

/**
 * POST /api/surveys/:id/respond — submit a respondent-signed response.
 *
 * The caller must already hold an Ed25519 signature over
 * `canonicalResponsePayload(...)`, signed by their OWN registered DID key —
 * this app never produces or holds that signature (see FINDINGS.md gap
 * #2394: `@ima-jin/auth-client`, the published browser SDK, has no signing
 * primitive yet, so today only a caller with independent key material can
 * exercise this route end-to-end).
 */
export async function POST(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request);
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const respondentDid = authResult.auth.did;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, cors);
  }

  const { answers, ticketId, issuedAt, signature } = body as {
    answers?: Record<string, unknown>;
    ticketId?: string;
    issuedAt?: number;
    signature?: string;
  };

  if (!answers || typeof answers !== 'object') {
    return errorResponse('answers object is required', 400, cors);
  }
  if (typeof issuedAt !== 'number') {
    return errorResponse('issuedAt (ms epoch) is required — it is part of the signed canonical payload', 400, cors);
  }
  if (!signature || typeof signature !== 'string') {
    return errorResponse('signature is required — see FINDINGS.md gap #2394', 400, cors);
  }

  try {
    const doc = await resolveSurveyDoc(id, request);
    if (!doc) {
      return errorResponse('Survey not found', 404, cors);
    }
    if (doc.status !== 'published') {
      return errorResponse('This survey is not currently accepting responses', 403, cors);
    }

    const missingFieldError = findMissingRequiredField(doc.fields, answers);
    if (missingFieldError) {
      return errorResponse(missingFieldError, 400, cors);
    }

    if (doc.settings.eventId) {
      try {
        const hasAccess = await defaultTicketGate().hasAccess({ eventId: doc.settings.eventId, did: respondentDid });
        if (!hasAccess) {
          return errorResponse('A ticket for this event is required to respond', 403, cors);
        }
      } catch (gateError) {
        if (gateError instanceof TicketGateNotConfiguredError) {
          return errorResponse(gateError.message, 501, cors);
        }
        throw gateError;
      }
    }

    const input = buildResponseAttestationInput({
      issuerDid: respondentDid,
      surveyOwnerDid: doc.ownerDid,
      surveyAssetId: id,
      payload: {
        provenance: 'respondent-signed',
        docHash: computeDocHash(doc),
        answers,
        ticketId: ticketId ?? null,
      },
      issuedAt,
      signature,
    });

    const attestation = await createAttestation(input);
    return jsonResponse({ message: 'Response submitted successfully', response: attestation }, 201, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to submit response');
    return errorResponse('Failed to submit response', 500, cors);
  }
}
