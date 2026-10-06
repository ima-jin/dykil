import { responseAttestationType, legacyImportAttestationType, DYKIL_SURVEY_CONTEXT_TYPE } from '@/lib/env';
import { canonicalAttestationPayload, type AttestationInput } from '@/lib/kernel/attestations';

/**
 * Every survey response is one of exactly two provenances, and the two must
 * stay distinguishable in the data (deliverable #4):
 *
 *  - `respondent-signed` — the respondent's own DID signed the attestation.
 *    This app never holds that key; the caller supplies a signature it
 *    produced itself (see FINDINGS.md gap #2394 for why that's client-side-
 *    only today, not something `@ima-jin/auth-client` does for a browser
 *    session).
 *  - `node-witnessed-legacy-import` — a one-time backport of a pre-migration
 *    `dykil.survey_responses` row that was never respondent-signed. Signed
 *    by THIS APP's own registered DID (never the kernel's), worded as a
 *    witness claim, and never upgraded — see scripts/import-legacy.ts.
 */
export type ResponseProvenance = 'respondent-signed' | 'node-witnessed-legacy-import';

export interface SurveyResponsePayload {
  provenance: ResponseProvenance;
  docHash: string;
  answers: Record<string, unknown>;
  ticketId: string | null;
  /**
   * The id of this issuer's own earlier response that this one replaces (an
   * "edit my answer"). Lives INSIDE the signed payload because the kernel
   * reads it from `payload.supersedes` (imajin-ai#2649): it retires the
   * earlier attestation only when it was issued by the same issuer. Omitted —
   * not null — when this is a first response, so the signed bytes of an
   * ordinary response never change.
   */
  supersedes?: string;
  /** Only present for node-witnessed-legacy-import (deliverable #3/#4). */
  legacyRowRef?: string;
  /** Only present for node-witnessed-legacy-import. */
  witnessedAt?: string;
  /** Only present for node-witnessed-legacy-import. */
  importedAt?: string;
}

export function surveyResponseAttestationType(provenance: ResponseProvenance): string {
  return provenance === 'respondent-signed' ? responseAttestationType() : legacyImportAttestationType();
}

/**
 * Build the exact `{...}` shape a respondent (or the import script) must
 * sign over, and the input `createAttestation` forwards. `subjectDid` is the
 * survey owner — "DID X (issuer, the respondent or the node-witness) said Y
 * about survey <docHash> (context_id), signed."
 */
export function buildResponseAttestationInput(params: {
  issuerDid: string;
  surveyOwnerDid: string;
  surveyAssetId: string;
  payload: SurveyResponsePayload;
  issuedAt: number;
  signature: string;
  /** Indexed lookup key — the response's `ticketId`, when it has one. Not part of the signed bytes. */
  ref?: string | null;
}): AttestationInput {
  return {
    issuerDid: params.issuerDid,
    subjectDid: params.surveyOwnerDid,
    type: surveyResponseAttestationType(params.payload.provenance),
    contextId: params.surveyAssetId,
    contextType: DYKIL_SURVEY_CONTEXT_TYPE,
    payload: params.payload as unknown as Record<string, unknown>,
    signature: params.signature,
    issuedAt: params.issuedAt,
    ref: params.ref ?? params.payload.ticketId,
  };
}

/** The exact bytes a respondent (or the import script) must sign — see canonicalAttestationPayload. */
export function canonicalResponsePayload(params: {
  surveyOwnerDid: string;
  surveyAssetId: string;
  payload: SurveyResponsePayload;
  issuedAt: number;
}): string {
  return canonicalAttestationPayload({
    subjectDid: params.surveyOwnerDid,
    type: surveyResponseAttestationType(params.payload.provenance),
    contextId: params.surveyAssetId,
    contextType: DYKIL_SURVEY_CONTEXT_TYPE,
    payload: params.payload as unknown as Record<string, unknown>,
    issuedAt: params.issuedAt,
  });
}
