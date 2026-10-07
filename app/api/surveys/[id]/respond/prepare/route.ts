import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_WRITE_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import { buildRespondentPayload, canonicalResponsePayload } from '@/lib/response-attestation';
import { loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { findMissingRequiredField } from '@/lib/survey';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * POST /api/surveys/:id/respond/prepare — what must a respondent sign?
 *
 * A response is signed by its respondent's own key; this app never holds one.
 * The canonical bytes embed the survey's content hash, which only the server
 * can compute, so a browser asks for them here, signs them with its own DID
 * key, and then POSTs the signature to `/respond`. Nothing is stored: this
 * validates the answers against the survey exactly as `/respond` will and
 * returns `{ canonical, issuedAt, payload }`. `issuedAt` is part of the signed
 * bytes, so the caller must send the same value back with the signature.
 */
export async function POST(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, cors);
  }
  const { answers } = body;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return errorResponse('answers object is required', 400, cors);
  }

  try {
    const doc = await loadSurveyDoc(id, request);
    if (!doc) return errorResponse('Survey not found', 404, cors);
    if (doc.status !== 'published') {
      return errorResponse('This survey is not currently accepting responses', 403, cors);
    }
    const missingFieldError = findMissingRequiredField(doc.fields, answers as Record<string, unknown>);
    if (missingFieldError) return errorResponse(missingFieldError, 400, cors);

    const payload = buildRespondentPayload({
      doc,
      answers: answers as Record<string, unknown>,
      ticketId: optionalString(body.ticketId),
      supersedes: optionalString(body.supersedes),
    });
    const issuedAt = Date.now();
    const canonical = canonicalResponsePayload({ surveyOwnerDid: doc.ownerDid, surveyAssetId: id, payload, issuedAt });
    return jsonResponse({ canonical, issuedAt, payload }, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError) return errorResponse(error.message, error.status, cors);
    log.error({ err: String(error) }, 'Failed to prepare response');
    return errorResponse('Failed to prepare response', 500, cors);
  }
}
