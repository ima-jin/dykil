import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@ima-jin/logger';
import { authenticate } from '@/lib/auth/authenticate';
import { DYKIL_WRITE_SCOPE } from '@/lib/auth/scopes';
import { KernelMediaError } from '@/lib/kernel/media';
import {
  ATTESTATION_REF_MAX_LENGTH,
  createAttestation,
  KernelAttestationError,
  type KernelAttestation,
} from '@/lib/kernel/attestations';
import { forwardedIdentityHeaders } from '@/lib/kernel/forward';
import { buildRespondentPayload, buildResponseAttestationInput } from '@/lib/response-attestation';
import { listAllSurveyResponses } from '@/lib/responses';
import { enforceTicketGate, loadSurveyDoc } from '@/lib/route-helpers';
import { corsHeaders, corsOptions, errorResponse, jsonResponse } from '@/lib/http';
import { findMissingRequiredField, type SurveyDoc } from '@/lib/survey';

const log = createLogger('dykil');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

interface RespondInput {
  answers: Record<string, unknown>;
  ticketId: string | null;
  issuedAt: number;
  signature: string;
  supersedes: string | null;
}

type ParsedRespondInput = { error: string } | { input: RespondInput };

function isOptionalString(value: unknown, maxLength: number): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/** Validate the request body. Every response is signed — there is no anonymous shape (imajin-ai#2536, ruling c). */
function parseRespondInput(body: Record<string, unknown>): ParsedRespondInput {
  const { answers, ticketId, issuedAt, signature, supersedes } = body;

  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { error: 'answers object is required' };
  }
  if (typeof issuedAt !== 'number') {
    return { error: 'issuedAt (ms epoch) is required — it is part of the signed canonical payload' };
  }
  if (!signature || typeof signature !== 'string') {
    return { error: 'signature is required — every response is signed by its respondent' };
  }
  if (!isOptionalString(ticketId, ATTESTATION_REF_MAX_LENGTH)) {
    return { error: `ticketId must be a non-empty string of at most ${ATTESTATION_REF_MAX_LENGTH} characters` };
  }
  if (!isOptionalString(supersedes, ATTESTATION_REF_MAX_LENGTH)) {
    return { error: 'supersedes must be a response id' };
  }

  return {
    input: {
      answers: answers as Record<string, unknown>,
      ticketId: (ticketId as string | undefined) ?? null,
      issuedAt,
      signature,
      supersedes: (supersedes as string | undefined) ?? null,
    },
  };
}

interface ExistingResponses {
  /** Active responses this respondent issued to the survey — the only ones they may supersede. */
  mine: KernelAttestation[];
  /** `mine` plus any active response (visible to the caller) carrying the same ticket ref. */
  all: KernelAttestation[];
}

/**
 * Look up the respondent's active responses to this survey (issuer filter)
 * and, for a ticketed response, any active response sharing its `ref`.
 * Superseded and revoked attestations are already excluded by the kernel's
 * default list read. Disclosure is `parties`, so a non-owner only ever sees
 * their own rows here.
 */
async function findExistingResponses(
  doc: SurveyDoc,
  surveyId: string,
  respondentDid: string,
  ticketId: string | null,
  headers: Record<string, string>,
): Promise<ExistingResponses> {
  const base = { ownerDid: doc.ownerDid, surveyId };
  const [mine, byTicket] = await Promise.all([
    listAllSurveyResponses({ ...base, issuerDid: respondentDid }, headers),
    ticketId ? listAllSurveyResponses({ ...base, ref: ticketId }, headers) : Promise.resolve([]),
  ]);
  const all = new Map<string, KernelAttestation>();
  for (const row of [...mine, ...byTicket]) all.set(row.id, row);
  return { mine, all: [...all.values()] };
}

/**
 * Decide whether a new response may be recorded.
 *
 *  - `supersedes` set: it must name one of the respondent's own active
 *    responses (the kernel re-checks same-issuer and retires the old row
 *    atomically with the insert).
 *  - otherwise, when the survey does not allow `multipleResponses`, any
 *    existing active response blocks it with a 409 carrying the id to edit.
 */
function checkSupersession(
  existing: ExistingResponses,
  supersedes: string | null,
  multipleResponses: boolean,
  cors: Record<string, string>,
): NextResponse | null {
  if (supersedes) {
    if (existing.mine.some((row) => row.id === supersedes)) return null;
    return errorResponse('supersedes must reference one of your own active responses to this survey', 404, cors);
  }
  if (!multipleResponses && existing.all.length > 0) {
    return NextResponse.json(
      {
        error: 'You have already responded to this survey — send "supersedes" with your response id to edit it',
        responseId: existing.all[0].id,
      },
      { status: 409, headers: cors },
    );
  }
  return null;
}

/**
 * POST /api/surveys/:id/respond — submit a respondent-signed response.
 *
 * The caller must already hold an Ed25519 signature over
 * `canonicalResponsePayload(...)`, produced by their OWN registered DID key —
 * this app never produces or holds that signature. The response is relayed to
 * `POST {kernel}/api/attestations` with the caller's own credentials, as:
 *
 *  - `type: dykil/survey-response`, `subject_did` = the survey owner,
 *    `context_id` = the survey asset id, `payload.docHash` binding it to the
 *    exact definition answered;
 *  - `ref` = the `ticketId`, when there is one (an indexed lookup key, not
 *    part of the signed bytes);
 *  - `payload.supersedes` = the id of the respondent's own earlier response,
 *    for an edit — inside the signed payload, since that is where the kernel
 *    reads it.
 *
 * No anonymous path: `allowAnonymous` was dropped (imajin-ai#2536, ruling c).
 */
export async function POST(request: NextRequest, props: RouteParams) {
  const { id } = await props.params;
  const cors = corsHeaders(request);

  const authResult = await authenticate(request, { requireScopes: [DYKIL_WRITE_SCOPE] });
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

  const parsed = parseRespondInput(body);
  if ('error' in parsed) {
    return errorResponse(parsed.error, 400, cors);
  }
  const { answers, ticketId, issuedAt, signature, supersedes } = parsed.input;

  try {
    const doc = await loadSurveyDoc(id, request);
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

    const gateFailure = await enforceTicketGate(doc, respondentDid, cors);
    if (gateFailure) return gateFailure;

    const callerHeaders = forwardedIdentityHeaders(request);
    const existing = await findExistingResponses(doc, id, respondentDid, ticketId, callerHeaders);
    const supersessionFailure = checkSupersession(existing, supersedes, doc.settings.multipleResponses === true, cors);
    if (supersessionFailure) return supersessionFailure;

    const payload = buildRespondentPayload({ doc, answers, ticketId, supersedes });
    const input = buildResponseAttestationInput({
      issuerDid: respondentDid,
      surveyOwnerDid: doc.ownerDid,
      surveyAssetId: id,
      payload,
      issuedAt,
      signature,
      ref: ticketId,
    });

    const attestation = await createAttestation(input, callerHeaders);
    return jsonResponse({ message: 'Response submitted successfully', response: attestation }, 201, cors);
  } catch (error) {
    if (error instanceof KernelMediaError || error instanceof KernelAttestationError) {
      return errorResponse(error.message, error.status, cors);
    }
    log.error({ err: String(error) }, 'Failed to submit response');
    return errorResponse('Failed to submit response', 500, cors);
  }
}
