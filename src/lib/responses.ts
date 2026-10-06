import { legacyImportAttestationType, responseAttestationType } from '@/lib/env';
import {
  listAllAttestations,
  listAttestationsPage,
  type AttestationPage,
  type KernelAttestation,
} from '@/lib/kernel/attestations';

/**
 * Survey responses are attestations of one of exactly two types — the
 * respondent-signed type and the node-witnessed legacy-import type (see
 * src/lib/response-attestation.ts). Every list below asks the kernel for
 * `subject_did` (the survey owner) + `context_id` (the survey asset id) and
 * keeps only those two types, so unrelated attestations that happen to share
 * a context id never leak into a survey's responses.
 */
export function isSurveyResponse(attestation: KernelAttestation): boolean {
  return attestation.type === responseAttestationType() || attestation.type === legacyImportAttestationType();
}

export interface SurveyResponseQuery {
  ownerDid: string;
  surveyId: string;
  /** Only responses this DID issued — what "my responses" / "have I responded" ask. */
  issuerDid?: string;
  /** Only responses carrying this indexed ref (a ticketId). */
  ref?: string;
}

/** One page of a survey's responses, newest first. `nextCursor` is the kernel's `X-Next-Cursor`. */
export async function listSurveyResponsesPage(
  query: SurveyResponseQuery & { before?: string; limit?: number },
  callerHeaders: HeadersInit,
): Promise<AttestationPage> {
  const page = await listAttestationsPage(
    {
      subjectDid: query.ownerDid,
      contextId: query.surveyId,
      issuerDid: query.issuerDid,
      ref: query.ref,
      before: query.before,
      limit: query.limit,
    },
    callerHeaders,
  );
  return { rows: page.rows.filter(isSurveyResponse), nextCursor: page.nextCursor };
}

/** Every response to a survey (cursor-paged under the hood) — the owner's export. */
export async function listAllSurveyResponses(
  query: SurveyResponseQuery,
  callerHeaders: HeadersInit,
): Promise<KernelAttestation[]> {
  const rows = await listAllAttestations(
    { subjectDid: query.ownerDid, contextId: query.surveyId, issuerDid: query.issuerDid, ref: query.ref },
    callerHeaders,
  );
  return rows.filter(isSurveyResponse);
}
