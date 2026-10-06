import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAllAttestationsMock, listAttestationsPageMock } = vi.hoisted(() => ({
  listAllAttestationsMock: vi.fn(),
  listAttestationsPageMock: vi.fn(),
}));

vi.mock('@/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/attestations')>('@/lib/kernel/attestations');
  return { ...actual, listAllAttestations: listAllAttestationsMock, listAttestationsPage: listAttestationsPageMock };
});

import type { KernelAttestation } from '@/lib/kernel/attestations';
import { isSurveyResponse, listAllSurveyResponses, listSurveyResponsesPage } from '../responses';

const row = (id: string, type: string) => ({ id, type }) as KernelAttestation;

describe('isSurveyResponse', () => {
  it('accepts exactly the respondent-signed and legacy-import types', () => {
    expect(isSurveyResponse(row('a', 'dykil/survey-response'))).toBe(true);
    expect(isSurveyResponse(row('b', 'dykil/survey-response-legacy-import'))).toBe(true);
    expect(isSurveyResponse(row('c', 'media.asset-created'))).toBe(false);
  });
});

describe('listSurveyResponsesPage', () => {
  beforeEach(() => {
    listAttestationsPageMock.mockReset();
  });

  it('asks the kernel for subject = owner and context_id = survey, keeps only response types, and keeps the cursor', async () => {
    listAttestationsPageMock.mockResolvedValue({
      rows: [row('a', 'dykil/survey-response'), row('x', 'other/type')],
      nextCursor: 'next',
    });

    const page = await listSurveyResponsesPage(
      { ownerDid: 'did:imajin:owner', surveyId: 'asset_1', issuerDid: 'did:imajin:r', ref: 'tkt_1', before: 'c0', limit: 10 },
      { authorization: 'Bearer t' },
    );

    expect(page).toEqual({ rows: [row('a', 'dykil/survey-response')], nextCursor: 'next' });
    expect(listAttestationsPageMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: 'did:imajin:r', ref: 'tkt_1', before: 'c0', limit: 10 },
      { authorization: 'Bearer t' },
    );
  });
});

describe('listAllSurveyResponses', () => {
  beforeEach(() => {
    listAllAttestationsMock.mockReset();
  });

  it('lists every page for the survey and filters to response types', async () => {
    listAllAttestationsMock.mockResolvedValue([row('a', 'dykil/survey-response'), row('x', 'other/type'), row('l', 'dykil/survey-response-legacy-import')]);

    const rows = await listAllSurveyResponses({ ownerDid: 'did:imajin:owner', surveyId: 'asset_1' }, { cookie: 'c=1' });

    expect(rows.map((r) => r.id)).toEqual(['a', 'l']);
    expect(listAllAttestationsMock).toHaveBeenCalledWith(
      { subjectDid: 'did:imajin:owner', contextId: 'asset_1', issuerDid: undefined, ref: undefined },
      { cookie: 'c=1' },
    );
  });
});
