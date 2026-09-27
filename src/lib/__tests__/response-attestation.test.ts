import { describe, expect, it } from 'vitest';
import { canonicalAttestationPayload } from '../kernel/attestations';
import {
  buildResponseAttestationInput,
  canonicalResponsePayload,
  surveyResponseAttestationType,
} from '../response-attestation';

describe('surveyResponseAttestationType', () => {
  it('uses the respondent-signed type for respondent-signed provenance', () => {
    expect(surveyResponseAttestationType('respondent-signed')).toBe('dykil/survey-response');
  });

  it('uses the legacy-import type for node-witnessed-legacy-import provenance', () => {
    expect(surveyResponseAttestationType('node-witnessed-legacy-import')).toBe('dykil/survey-response-legacy-import');
  });

  it('keeps the two types distinguishable', () => {
    expect(surveyResponseAttestationType('respondent-signed')).not.toBe(
      surveyResponseAttestationType('node-witnessed-legacy-import'),
    );
  });
});

describe('canonicalResponsePayload', () => {
  it('matches canonicalAttestationPayload for the exact same logical input', () => {
    const params = {
      surveyOwnerDid: 'did:imajin:owner',
      surveyAssetId: 'asset_123',
      payload: { provenance: 'respondent-signed' as const, docHash: 'sha256:abc', answers: { q1: 'yes' }, ticketId: null },
      issuedAt: 1_700_000_000_000,
    };
    const viaHelper = canonicalResponsePayload(params);
    const viaDirect = canonicalAttestationPayload({
      subjectDid: params.surveyOwnerDid,
      type: 'dykil/survey-response',
      contextId: params.surveyAssetId,
      contextType: 'dykil.survey',
      payload: params.payload,
      issuedAt: params.issuedAt,
    });
    expect(viaHelper).toBe(viaDirect);
  });

  it('produces a different canonical string for a different payload', () => {
    const base = {
      surveyOwnerDid: 'did:imajin:owner',
      surveyAssetId: 'asset_123',
      issuedAt: 1_700_000_000_000,
    };
    const a = canonicalResponsePayload({
      ...base,
      payload: { provenance: 'respondent-signed' as const, docHash: 'sha256:abc', answers: { q1: 'yes' }, ticketId: null },
    });
    const b = canonicalResponsePayload({
      ...base,
      payload: { provenance: 'respondent-signed' as const, docHash: 'sha256:abc', answers: { q1: 'no' }, ticketId: null },
    });
    expect(a).not.toBe(b);
  });
});

describe('buildResponseAttestationInput', () => {
  it('builds the exact attestation input shape, subject = survey owner, issuer = the signer', () => {
    const input = buildResponseAttestationInput({
      issuerDid: 'did:imajin:respondent',
      surveyOwnerDid: 'did:imajin:owner',
      surveyAssetId: 'asset_123',
      payload: { provenance: 'respondent-signed', docHash: 'sha256:abc', answers: { q1: 'yes' }, ticketId: 'tkt_1' },
      issuedAt: 1_700_000_000_000,
      signature: 'deadbeef',
    });

    expect(input).toEqual({
      issuerDid: 'did:imajin:respondent',
      subjectDid: 'did:imajin:owner',
      type: 'dykil/survey-response',
      contextId: 'asset_123',
      contextType: 'dykil.survey',
      payload: { provenance: 'respondent-signed', docHash: 'sha256:abc', answers: { q1: 'yes' }, ticketId: 'tkt_1' },
      signature: 'deadbeef',
      issuedAt: 1_700_000_000_000,
    });
  });

  it('routes node-witnessed-legacy-import payloads to the legacy-import type', () => {
    const input = buildResponseAttestationInput({
      issuerDid: 'did:imajin:dykil-app',
      surveyOwnerDid: 'did:imajin:owner',
      surveyAssetId: 'asset_123',
      payload: {
        provenance: 'node-witnessed-legacy-import',
        docHash: 'sha256:abc',
        answers: {},
        ticketId: null,
        legacyRowRef: 'dykil.survey_responses/survey_1/response_1',
        witnessedAt: '2025-01-01T00:00:00.000Z',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
      issuedAt: 1_700_000_000_000,
      signature: 'deadbeef',
    });
    expect(input.type).toBe('dykil/survey-response-legacy-import');
    expect(input.payload.legacyRowRef).toBe('dykil.survey_responses/survey_1/response_1');
  });
});
