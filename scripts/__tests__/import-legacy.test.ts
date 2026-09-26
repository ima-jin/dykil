import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientMock, listAttestationsMock, createAttestationMock, signMock } = vi.hoisted(() => ({
  clientMock: {
    connect: vi.fn(),
    end: vi.fn(),
    query: vi.fn(),
  },
  listAttestationsMock: vi.fn(),
  createAttestationMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock('pg', () => ({ Client: vi.fn(() => clientMock) }));
vi.mock('@ima-jin/auth', async () => {
  const actual = await vi.importActual<typeof import('@ima-jin/auth')>('@ima-jin/auth');
  return { ...actual, sign: signMock };
});
vi.mock('../../src/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/kernel/attestations')>('../../src/lib/kernel/attestations');
  return { ...actual, listAttestations: listAttestationsMock, createAttestation: createAttestationMock };
});

const legacySurveyRow = {
  id: 'survey_1',
  did: 'did:imajin:owner',
  title: 'Old survey',
  description: null,
  fields: { elements: [{ name: 'q1', type: 'text', title: 'Q1' }] },
  settings: {},
  type: 'survey',
  status: 'published',
  created_at: new Date('2025-01-01T00:00:00.000Z'),
  updated_at: new Date('2025-01-02T00:00:00.000Z'),
};

const legacyResponseRow = {
  id: 'response_1',
  survey_id: 'survey_1',
  respondent_did: null,
  ticket_id: null,
  answers: { q1: 'yes' },
  created_at: new Date('2025-01-03T00:00:00.000Z'),
};

describe('scripts/import-legacy', () => {
  beforeEach(() => {
    vi.resetModules();
    clientMock.connect.mockReset().mockResolvedValue(undefined);
    clientMock.end.mockReset().mockResolvedValue(undefined);
    clientMock.query.mockReset();
    clientMock.query.mockImplementation((sql: string) => {
      if (sql.includes('dykil.surveys')) return Promise.resolve({ rows: [legacySurveyRow] });
      if (sql.includes('dykil.survey_responses')) return Promise.resolve({ rows: [legacyResponseRow] });
      return Promise.resolve({ rows: [] });
    });
    listAttestationsMock.mockReset().mockResolvedValue([]);
    createAttestationMock.mockReset().mockResolvedValue({ id: 'att_new' });
    signMock.mockReset().mockResolvedValue({ signature: 'sig-hex' });

    process.env.LEGACY_DATABASE_URL = 'postgres://legacy';
    process.env.MEDIA_SERVICE_URL = 'https://dev-jin.imajin.ai/media';
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
    process.env.IMAJIN_APP_DID = 'did:imajin:dykil-app';
    process.env.DYKIL_APP_PRIVATE_KEY = 'deadbeef';
  });

  it('throws when LEGACY_DATABASE_URL is not set', async () => {
    delete process.env.LEGACY_DATABASE_URL;
    const { runImport } = await import('../import-legacy');
    await expect(runImport([])).rejects.toThrow('LEGACY_DATABASE_URL');
  });

  it('dry-run (default, no --commit) reads legacy data but writes nothing', async () => {
    const { runImport } = await import('../import-legacy');
    const summary = await runImport([]);

    expect(summary.surveysRead).toBe(1);
    expect(summary.responsesRead).toBe(1);
    expect(summary.documentsCreated).toBe(0);
    expect(summary.attestationsCreated).toBe(0);
    expect(createAttestationMock).not.toHaveBeenCalled();
    expect(fetchWasCalledForAssetUpload()).toBe(false);
  });

  it('requires the app keypair to --commit', async () => {
    delete process.env.DYKIL_APP_PRIVATE_KEY;
    const { runImport } = await import('../import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('DYKIL_APP_PRIVATE_KEY');
  });

  it("--commit emits a NODE-WITNESSED LEGACY-IMPORT attestation, signed by the app's own DID, never the kernel's", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) }),
    );

    const { runImport } = await import('../import-legacy');
    const summary = await runImport(['--commit']);

    expect(summary.documentsCreated).toBe(1);
    expect(summary.attestationsCreated).toBe(1);

    expect(signMock).toHaveBeenCalledTimes(1);
    const [, privateKeyArg, identityArg] = signMock.mock.calls[0];
    expect(privateKeyArg).toBe('deadbeef');
    expect(identityArg).toEqual({ id: 'did:imajin:dykil-app', type: 'agent' });

    const [attestationInput] = createAttestationMock.mock.calls[0];
    expect(attestationInput.issuerDid).toBe('did:imajin:dykil-app');
    expect(attestationInput.subjectDid).toBe('did:imajin:owner');
    expect(attestationInput.type).toBe('dykil/survey-response-legacy-import');
    expect(attestationInput.payload.provenance).toBe('node-witnessed-legacy-import');
    expect(attestationInput.payload.legacyRowRef).toBe('dykil.survey_responses/survey_1/response_1');
    expect(attestationInput.payload.witnessedAt).toBe('2025-01-03T00:00:00.000Z');

    vi.unstubAllGlobals();
  });

  it('is idempotent: skips a legacy row whose legacyRowRef was already imported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) }));
    listAttestationsMock.mockResolvedValue([
      { id: 'att_existing', payload: { legacyRowRef: 'dykil.survey_responses/survey_1/response_1' } },
    ]);

    const { runImport } = await import('../import-legacy');
    const summary = await runImport(['--commit']);

    expect(summary.skippedAlreadyImported).toBe(1);
    expect(summary.attestationsCreated).toBe(0);
    expect(createAttestationMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function fetchWasCalledForAssetUpload(): boolean {
  const globalFetch = globalThis.fetch as unknown as { mock?: { calls: unknown[] } } | undefined;
  return Boolean(globalFetch?.mock && globalFetch.mock.calls.length > 0);
}
