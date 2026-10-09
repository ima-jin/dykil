import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clientMock,
  listAllAttestationsMock,
  createAttestationMock,
  signMock,
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
  signMock: vi.fn(),
  bootstrapSigningIdentityMock: vi.fn(),
  getSigningIdentityMock: vi.fn(),
  getAppServiceTokenMock: vi.fn(),
}));

vi.mock('pg', () => ({ Client: vi.fn(() => clientMock) }));
vi.mock('@ima-jin/auth', async () => {
  const actual = await vi.importActual<typeof import('@ima-jin/auth')>('@ima-jin/auth');
  return { ...actual, sign: signMock };
});
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
    listAllAttestationsMock.mockReset().mockResolvedValue([]);
    createAttestationMock.mockReset().mockResolvedValue({ id: 'att_new' });
    signMock.mockReset().mockResolvedValue({ signature: 'sig-hex' });
    bootstrapSigningIdentityMock.mockReset().mockResolvedValue(undefined);
    getAppServiceTokenMock.mockReset().mockResolvedValue('app-token-1');
    getSigningIdentityMock.mockReset().mockReturnValue({
      appDid: 'did:imajin:dykil-app',
      privateKey: 'deadbeef',
      publicKey: 'pub-hex',
    });

    process.env.LEGACY_DATABASE_URL = 'postgres://legacy';
    process.env.MEDIA_SERVICE_URL = 'https://dev-jin.imajin.ai/media';
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
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
    expect(getAppServiceTokenMock).not.toHaveBeenCalled();
  });

  it('dry-run needs no credentials: it never bootstraps the signing identity or mints a token', async () => {
    getAppServiceTokenMock.mockRejectedValue(new Error('no credentials'));
    bootstrapSigningIdentityMock.mockRejectedValue(new Error('no credentials'));
    const { runImport } = await import('../import-legacy');
    await expect(runImport([])).resolves.toMatchObject({ surveysRead: 1, responsesRead: 1 });
    expect(bootstrapSigningIdentityMock).not.toHaveBeenCalled();
  });

  it('--commit fails loudly, before any write, when the app token cannot be minted (unclaimed app)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getAppServiceTokenMock.mockRejectedValue(new Error('this app has not been claimed'));

    const { runImport } = await import('../import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('has not been claimed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createAttestationMock).not.toHaveBeenCalled();
    expect(clientMock.connect).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("--commit sends the app's own token as Authorization on the media /api/assets POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const { runImport } = await import('../import-legacy');
    await runImport(['--commit']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer app-token-1' });

    vi.unstubAllGlobals();
  });

  it("--commit sends the app's own token on the attestation write and the idempotency lookup", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) }));

    const { runImport } = await import('../import-legacy');
    await runImport(['--commit']);

    expect(createAttestationMock).toHaveBeenCalledTimes(1);
    expect(createAttestationMock.mock.calls[0][1]).toEqual({ Authorization: 'Bearer app-token-1' });
    expect(listAllAttestationsMock.mock.calls[0][1]).toEqual({ Authorization: 'Bearer app-token-1' });

    vi.unstubAllGlobals();
  });

  it('requires a fetchable signing key to --commit', async () => {
    bootstrapSigningIdentityMock.mockRejectedValue(
      new Error("loadAppSigningKey: no keystore found and no claim code provided — first boot requires IMAJIN_APP_CLAIM_CODE"),
    );
    const { runImport } = await import('../import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('IMAJIN_APP_CLAIM_CODE');
    expect(getSigningIdentityMock).not.toHaveBeenCalled();
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
    expect(attestationInput.ref).toBeNull();

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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const { runImport } = await import('../import-legacy');
    await runImport(['--commit']);

    const form = fetchMock.mock.calls[0][1].body as FormData;
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const { runImport } = await import('../import-legacy');
    await runImport(['--commit']);

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(JSON.parse(await (form.get('file') as Blob).text()).settings).toEqual({});

    vi.unstubAllGlobals();
  });

  it('is idempotent: skips a legacy row whose legacyRowRef was already imported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) }));
    listAllAttestationsMock.mockResolvedValue([
      { id: 'att_existing', payload: { legacyRowRef: 'dykil.survey_responses/survey_1/response_1' } },
    ]);

    const { runImport } = await import('../import-legacy');
    const summary = await runImport(['--commit']);

    expect(summary.skippedAlreadyImported).toBe(1);
    expect(summary.attestationsCreated).toBe(0);
    expect(createAttestationMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('throws when the kernel rejects a legacy survey document upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));

    const { runImport } = await import('../import-legacy');
    await expect(runImport(['--commit'])).rejects.toThrow('Failed to create signed doc for legacy survey survey_1: 502');

    vi.unstubAllGlobals();
  });

  it('skips an orphaned response row whose survey_id has no matching legacy survey', async () => {
    clientMock.query.mockImplementation((sql: string) => {
      if (sql.includes('dykil.surveys')) return Promise.resolve({ rows: [] });
      if (sql.includes('dykil.survey_responses')) return Promise.resolve({ rows: [legacyResponseRow] });
      return Promise.resolve({ rows: [] });
    });

    const { runImport } = await import('../import-legacy');
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
