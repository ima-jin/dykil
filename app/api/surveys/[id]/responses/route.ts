import { NextRequest } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { readOwnerSurveyAsset, readPublicSurveyAsset, KernelMediaError } from '@/lib/kernel/media';
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
 * GET /api/surveys/:id/responses — all responses for a survey (owner only).
 *
 * Sourced from `GET {kernel}/api/attestations?subject_did=...&type=...` for
 * both response types (respondent-signed and node-witnessed-legacy-import),
 * filtered to this survey's `context_id` client-side — the public
 * attestations API has no `context_id` filter (see FINDINGS.md gap #2396).
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request);
  if ('error' in authResult) {
    return errorResponse(authResult.error, authResult.status, cors);
  }
  const did = authResult.auth.did;

  try {
    const publicContent = await readPublicSurveyAsset(id);
    const doc = publicContent && isSurveyDoc(publicContent) ? publicContent : null;
    const owned = doc ?? (await readOwnerSurveyAsset(id, request).catch(() => null))?.content;
    if (!owned || !isSurveyDoc(owned)) {
      return errorResponse('Survey not found', 404, cors);
    }
    if (owned.ownerDid !== did) {
      return errorResponse('Not authorized to view responses', 403, cors);
    }

    const [respondentSigned, legacyImported] = await Promise.all([
      listAttestations({ subjectDid: owned.ownerDid, type: responseAttestationType() }),
      listAttestations({ subjectDid: owned.ownerDid, type: legacyImportAttestationType() }),
    ]);

    const responses = [...respondentSigned, ...legacyImported]
      .filter((attestation) => attestation.contextId === id)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());

    return jsonResponse({ responses, total: responses.length }, 200, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to fetch responses');
    return errorResponse('Failed to fetch responses', 500, cors);
  }
}
