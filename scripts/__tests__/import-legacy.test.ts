import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalize, crypto, sign } from '@ima-jin/auth';
import type { AttestationInput } from '../../src/lib/kernel/attestations';

const {
  clientMock,
  listAllAttestationsMock,
  createAttestationMock,
  bootstrapSigningIdentityMock,
  getSigningIdentityMock,
  getAppServiceTokenMock,
} = vi.hoisted(() => ({
  clientMock: {
    connect: vi.fn(),
    end: vi.fn(),
    query: vi.fn(),
  },
  listAllAttestationsMock: vi.fn(),
  createAttestationMock: vi.fn(),
  bootstrapSigningIdentityMock: vi.fn(),
  getSigningIdentityMock: vi.fn(),
  getAppServiceTokenMock: vi.fn(),
}));

vi.mock('pg', () => ({ Client: vi.fn(() => clientMock) }));
vi.mock('../lib/legacy-vault-boot.mjs', () => ({
  legacyBoot: { getConfig: () => ({ legacyDatabaseUrl: 'FAKE_TEST_LEGACY_URL_NOT_A_CONNECTION_STRING' }) },
}));
vi.mock('../../src/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/kernel/attestations')>('../../src/lib/kernel/attestations');
  return { ...actual, listAllAttestations: listAllAttestationsMock, createAttestation: createAttestationMock };
});
vi.mock('../../src/lib/app-service-token', () => ({
  getAppServiceToken: getAppServiceTokenMock,
  appServiceAuthHeaders: async () => ({ Authorization: `Bearer ${await getAppServiceTokenMock()}` }),
}));
vi.mock('../../src/lib/auth/signing-identity', () => ({
  bootstrapSigningIdentity: bootstrapSigningIdentityMock,
  getSigningIdentity: getSigningIdentityMock,
}));

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
// Ephemeral test-only keys: use the real published signer and verifier.
const witnessKeys = crypto.generateKeypair();

/** Reproduce the kernel's canonical field shape independently of the app builder. */
function kernelSigningMessage(input: AttestationInput): string {
  return canonicalize({
    subject_did: input.subjectDid,
    type: input.type,
    context_id: input.contextId,
    context_type: input.contextType,
    payload: input.payload,
    issued_at: input.issuedAt,
  });
}

function mockMedia() {
  const assets: { id: string; filename: string }[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const file = (init.body as FormData).get('file') as File;
      const asset = { id: `asset_${assets.length + 1}`, filename: file.name };
      assets.push(asset);
      return Response.json(asset);
    }
    const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
    return Response.json({ assets: assets.slice(offset, offset + 200) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { assets, fetchMock };
}

const legacyResponseRow = {
  id: 'response_1',
  survey_id: 'survey_1',
  respondent_did: null,
  ticket_id: null,
  answers: { q1: 'yes' },
  created_at: new Date('2025-01-03T00:00:00.000Z'),
};

describe('scripts/import-legacy', () => {
  afterEach(() => vi.unstubAllGlobals());
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
    listAllAttestationsMock.mockReset().mockResolvedValue([]);
    createAttestationMock.mockReset().mockResolvedValue({ id: 'att_new' });
    bootstrapSigningIdentityMock.mockReset().mockResolvedValue(undefined);
    getAppServiceTokenMock.mockReset().mockResolvedValue('app-token-1');
    getSigningIdentityMock.mockReset().mockReturnValue({
      appDid: 'did:imajin:dykil-app',
      ...witnessKeys,
    });

    process.env.MEDIA_SERVICE_URL = 'https://dev-jin.imajin.ai/media';
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  it('uses initialized vault configuration without reading an env credential', async () => {
    const { Client } = await import('pg');
    const { runImport } = await import('../lib/import-legacy');
    await runImport([]);
    expect(Client).toHaveBeenCalledWith({ connectionString: 'FAKE_TEST_LEGACY_URL_NOT_A_CONNECTION_STRING' });
  });

  it('dry-run (default, no --commit) reads legacy data but writes nothing', async () => {
    const { runImport } = await import('../lib/import-legacy');
    const summary = await runImport([]);

    expect(summary.surveysRead).toBe(1);
    expect(summary.responsesRead).toBe(1);
    expect(summary.documentsCreated).toBe(0);
    expect(summary.attestationsCreated).toBe(0);
    expect(createAttestationMock).not.toHaveBeenCalled();
    expect(fetchWasCalledForAssetUpload()).toBe(false);
    expect(getAppServiceTokenMock).not.toHaveBeenCalled();
  });

  it('dry-run needs no signing identity or token beyond its vault-loaded read-only DB config', async () => {
    getAppServiceTokenMock.mockRejectedValue(new Error('no credentials'));
    bootstrapSigningIdentityMock.mockRejectedValue(new Error('no credentials'));
    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport([])).resolves.toMatchObject({ surveysRead: 1, responsesRead: 1 });
    expect(bootstrapSigningIdentityMock).not.toHaveBeenCalled();
  });

  it('--commit fails loudly, before any write, when the app token cannot be minted (unclaimed app)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getAppServiceTokenMock.mockRejectedValue(new Error('this app has not been claimed'));

    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('has not been claimed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createAttestationMock).not.toHaveBeenCalled();
    expect(clientMock.connect).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("--commit sends the app's own token as Authorization on the media /api/assets POST", async () => {
    const { fetchMock } = mockMedia();

    const { runImport } = await import('../lib/import-legacy');
    await runImport(['--commit']);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: 'Bearer app-token-1' });
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0];
    expect(new URL(lookupUrl).searchParams.get('context_app')).toBe('dykil');
    expect(new URL(lookupUrl).searchParams.get('context_feature')).toBe('survey');
    expect(new URL(lookupUrl).searchParams.has('did')).toBe(false);
    expect(lookupInit?.headers).toEqual({ authorization: 'Bearer app-token-1' });

    vi.unstubAllGlobals();
  });

  it("--commit sends the app's own token on the attestation write and the idempotency lookup", async () => {
    mockMedia();

    const { runImport } = await import('../lib/import-legacy');
    await runImport(['--commit']);

    expect(createAttestationMock).toHaveBeenCalledTimes(1);
    expect(createAttestationMock.mock.calls[0][1]).toEqual({ Authorization: 'Bearer app-token-1' });
    expect(listAllAttestationsMock.mock.calls[0][1]).toEqual({ Authorization: 'Bearer app-token-1' });

    vi.unstubAllGlobals();
  });

  it('requires a fetchable signing key to --commit', async () => {
    bootstrapSigningIdentityMock.mockRejectedValue(
      new Error('Signing identity not bootstrapped yet — claim this app at /dykil/claim'),
    );
    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('/dykil/claim');
    expect(getSigningIdentityMock).not.toHaveBeenCalled();
  });

  it("--commit emits a NODE-WITNESSED LEGACY-IMPORT attestation, signed by the app's own DID, never the kernel's", async () => {
    mockMedia();

    const { runImport } = await import('../lib/import-legacy');
    const summary = await runImport(['--commit']);

    expect(summary.documentsCreated).toBe(1);
    expect(summary.attestationsCreated).toBe(1);

    const [attestationInput] = createAttestationMock.mock.calls[0];
    expect(attestationInput.issuerDid).toBe('did:imajin:dykil-app');
    expect(attestationInput.subjectDid).toBe('did:imajin:owner');
    expect(attestationInput.type).toBe('dykil/survey-response-legacy-import');
    expect(attestationInput.payload.provenance).toBe('node-witnessed-legacy-import');
    expect(attestationInput.payload.legacyRowRef).toBe('dykil.survey_responses/survey_1/response_1');
    expect(attestationInput.payload.witnessedAt).toBe('2025-01-03T00:00:00.000Z');
    expect(attestationInput.ref).toBeNull();
    expect(attestationInput.signature).toMatch(/^[0-9a-f]{128}$/);
    const canonical = kernelSigningMessage(attestationInput);
    expect(crypto.verifySync(attestationInput.signature, canonical, witnessKeys.publicKey)).toBe(true);
    expect(crypto.verifySync(
      attestationInput.signature,
      kernelSigningMessage({ ...attestationInput, contextId: 'different-survey' }),
      witnessKeys.publicKey,
    )).toBe(false);
    const envelope = await sign(canonical, witnessKeys.privateKey, { id: attestationInput.issuerDid, type: 'agent' });
    expect(crypto.verifySync(envelope.signature, canonical, witnessKeys.publicKey)).toBe(false);

    vi.unstubAllGlobals();
  });

  it('carries a legacy ticket id as the indexed ref and drops allowAnonymous from the imported document', async () => {
    clientMock.query.mockImplementation((sql: string) => {
      if (sql.includes('dykil.surveys')) {
        return Promise.resolve({ rows: [{ ...legacySurveyRow, settings: { allowAnonymous: true, multipleResponses: true } }] });
      }
      if (sql.includes('dykil.survey_responses')) {
        return Promise.resolve({ rows: [{ ...legacyResponseRow, ticket_id: 'tkt_9' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { fetchMock } = mockMedia();

    const { runImport } = await import('../lib/import-legacy');
    await runImport(['--commit']);

    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    const uploaded = JSON.parse(await (form.get('file') as Blob).text());
    expect(uploaded.settings).toEqual({ multipleResponses: true });

    const [attestationInput] = createAttestationMock.mock.calls[0];
    expect(attestationInput.ref).toBe('tkt_9');
    expect(attestationInput.payload.ticketId).toBe('tkt_9');

    vi.unstubAllGlobals();
  });

  it('imports a survey whose legacy settings are malformed with no settings rather than failing', async () => {
    clientMock.query.mockImplementation((sql: string) => {
      if (sql.includes('dykil.surveys')) return Promise.resolve({ rows: [{ ...legacySurveyRow, settings: ['nope'] }] });
      return Promise.resolve({ rows: [] });
    });
    const { fetchMock } = mockMedia();

    const { runImport } = await import('../lib/import-legacy');
    await runImport(['--commit']);

    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(JSON.parse(await (form.get('file') as Blob).text()).settings).toEqual({});

    vi.unstubAllGlobals();
  });

  it('is idempotent: skips a legacy row whose legacyRowRef was already imported', async () => {
    mockMedia();
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_existing', payload: { legacyRowRef: 'dykil.survey_responses/survey_1/response_1' } },
    ]);

    const { runImport } = await import('../lib/import-legacy');
    const summary = await runImport(['--commit']);

    expect(summary.skippedAlreadyImported).toBe(1);
    expect(summary.attestationsCreated).toBe(0);
    expect(createAttestationMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('throws when the kernel rejects a legacy survey document upload', async () => {
    const { fetchMock } = mockMedia();
    fetchMock.mockResolvedValueOnce(Response.json({ assets: [] }));
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 502 }));

    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('Failed to create signed doc for legacy survey survey_1: 502');

    vi.unstubAllGlobals();
  });

  it('reuses four orphaned survey docs, verifies all 39 signatures, then skips every response on a rerun', async () => {
    const surveys = Array.from({ length: 4 }, (_, index) => ({ ...legacySurveyRow, id: `survey_${index + 1}` }));
    const responses = Array.from({ length: 39 }, (_, index) => ({
      ...legacyResponseRow,
      id: `response_${index + 1}`,
      survey_id: surveys[index % surveys.length].id,
    }));
    clientMock.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('dykil.surveys') ? surveys : responses,
    }));
    const { assets, fetchMock } = mockMedia();
    assets.push(...surveys.map((row) => ({ id: `orphan_${row.id}`, filename: `dykil-survey-${row.id}.json` })));
    const saved: AttestationInput[] = [];
    createAttestationMock.mockImplementation(async (input: AttestationInput) => {
      expect(crypto.verifySync(input.signature, kernelSigningMessage(input), witnessKeys.publicKey)).toBe(true);
      saved.push(input);
      return { id: `att_${saved.length}` };
    });
    listAllAttestationsMock.mockImplementation(async () => [...saved]);

    const { runImport } = await import('../lib/import-legacy');
    expect(await runImport(['--commit'])).toEqual({
      surveysRead: 4, responsesRead: 39, documentsCreated: 0, attestationsCreated: 39, skippedAlreadyImported: 0,
    });
    for (const input of saved) {
      const response = responses.find((row) => input.payload.legacyRowRef === `dykil.survey_responses/${row.survey_id}/${row.id}`);
      expect(input.contextId).toBe(`orphan_${response?.survey_id}`);
    }
    // A new worker invocation must discover persisted assets, not rely on an in-memory ledger.
    vi.resetModules();
    const { runImport: rerun } = await import('../lib/import-legacy');
    expect(await rerun(['--commit'])).toEqual({
      surveysRead: 4, responsesRead: 39, documentsCreated: 0, attestationsCreated: 0, skippedAlreadyImported: 39,
    });
    expect(assets).toHaveLength(4);
    expect(createAttestationMock).toHaveBeenCalledTimes(39);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('creates one document on a fresh import and no duplicates on a second run', async () => {
    const { assets, fetchMock } = mockMedia();
    const { runImport } = await import('../lib/import-legacy');
    expect((await runImport(['--commit'])).documentsCreated).toBe(1);
    listAllAttestationsMock.mockResolvedValue([{
      payload: { legacyRowRef: 'dykil.survey_responses/survey_1/response_1' },
    }]);
    expect(await runImport(['--commit'])).toMatchObject({
      documentsCreated: 0, attestationsCreated: 0, skippedAlreadyImported: 1,
    });
    expect(assets).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('reuses a successful upload after an attestation failure instead of leaving another orphan', async () => {
    const { assets, fetchMock } = mockMedia();
    createAttestationMock.mockRejectedValueOnce(new Error('attestation unavailable'));
    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('attestation unavailable');
    expect(assets).toHaveLength(1);
    expect(await runImport(['--commit'])).toMatchObject({ documentsCreated: 0, attestationsCreated: 1 });
    expect(createAttestationMock.mock.calls[1][0].contextId).toBe(assets[0].id);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('finds an existing survey beyond the first listing page and requires an exact filename', async () => {
    const { assets, fetchMock } = mockMedia();
    assets.push(...Array.from({ length: 200 }, (_, index) => ({
      id: `other_${index}`, filename: `dykil-survey-survey_1.json.${index}`,
    })));
    assets.push({ id: 'existing', filename: 'dykil-survey-survey_1.json' });
    const { runImport } = await import('../lib/import-legacy');
    expect((await runImport(['--commit'])).documentsCreated).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('offset')).toBe('200');
    expect(createAttestationMock.mock.calls[0][0].contextId).toBe('existing');
  });

  it('does not mistake a filename prefix match for an imported survey', async () => {
    const { assets } = mockMedia();
    assets.push({ id: 'other', filename: 'dykil-survey-survey_1.json.backup' });
    const { runImport } = await import('../lib/import-legacy');
    expect((await runImport(['--commit'])).documentsCreated).toBe(1);
    expect(createAttestationMock.mock.calls[0][0].contextId).toBe('asset_2');
  });

  it('fails closed before writes if existing documents cannot be listed', async () => {
    const { fetchMock } = mockMedia();
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'listing denied' }, { status: 403 }));
    const { runImport } = await import('../lib/import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('listing denied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createAttestationMock).not.toHaveBeenCalled();
    expect(clientMock.end).toHaveBeenCalledOnce();
  });

  it('deduplicates repeated source rows within a run after each successful write', async () => {
    clientMock.query.mockImplementation((sql: string) => Promise.resolve({
      rows: sql.includes('dykil.surveys') ? [legacySurveyRow, legacySurveyRow] : [legacyResponseRow, legacyResponseRow],
    }));
    const { assets } = mockMedia();
    const { runImport } = await import('../lib/import-legacy');
    expect(await runImport(['--commit'])).toMatchObject({
      documentsCreated: 1, attestationsCreated: 1, skippedAlreadyImported: 1,
    });
    expect(assets).toHaveLength(1);
  });

  it('skips an orphaned response row whose survey_id has no matching legacy survey', async () => {
    clientMock.query.mockImplementation((sql: string) => {
      if (sql.includes('dykil.surveys')) return Promise.resolve({ rows: [] });
      if (sql.includes('dykil.survey_responses')) return Promise.resolve({ rows: [legacyResponseRow] });
      return Promise.resolve({ rows: [] });
    });

    const { runImport } = await import('../lib/import-legacy');
    const summary = await runImport([]);

    expect(summary.surveysRead).toBe(0);
    expect(summary.responsesRead).toBe(1);
    expect(summary.skippedAlreadyImported).toBe(1);
    expect(createAttestationMock).not.toHaveBeenCalled();
  });
});

function fetchWasCalledForAssetUpload(): boolean {
  const globalFetch = globalThis.fetch as unknown as { mock?: { calls: unknown[] } } | undefined;
  return Boolean(globalFetch?.mock && globalFetch.mock.calls.length > 0);
}
