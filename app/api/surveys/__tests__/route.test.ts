import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, createSurveyAssetMock, listMySurveyAssetsMock, readOwnerSurveyAssetMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  createSurveyAssetMock: vi.fn(),
  listMySurveyAssetsMock: vi.fn(),
  readOwnerSurveyAssetMock: vi.fn(),
}));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return {
    ...actual,
    createSurveyAsset: createSurveyAssetMock,
    listMySurveyAssets: listMySurveyAssetsMock,
    readOwnerSurveyAsset: readOwnerSurveyAssetMock,
  };
});

import { GET, POST } from '../route';

function jsonRequest(body: unknown) {
  return new Request('https://dykil.imajin.ai/api/surveys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/surveys', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createSurveyAssetMock.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const response = await POST(jsonRequest({ title: 'X', fields: [] }) as never);
    expect(response.status).toBe(401);
  });

  it('returns 400 when title is missing', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    const response = await POST(jsonRequest({ fields: [] }) as never);
    expect(response.status).toBe(400);
  });

  it('creates a survey as a signed media-asset document owned by the caller', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    createSurveyAssetMock.mockResolvedValue({ id: 'asset_1' });

    const response = await POST(
      jsonRequest({ title: 'My survey', fields: [{ id: 'f1', type: 'text', label: 'Name', required: true }], status: 'published' }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('asset_1');
    expect(body.ownerDid).toBe('did:imajin:owner');
    expect(body.status).toBe('published');

    const [createArgs] = createSurveyAssetMock.mock.calls[0];
    expect(createArgs.access).toBe('public');
    expect(createArgs.filename).toMatch(/^dykil-survey-.*\.json$/);
    const uploadedDoc = JSON.parse(createArgs.content);
    expect(uploadedDoc.fields).toEqual({ elements: [{ id: 'f1', type: 'text', label: 'Name', required: true }] });
  });

  it('requires the dykil:write scope', async () => {
    authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:write', status: 403 });

    const response = await POST(jsonRequest({ title: 'X', fields: [] }) as never);

    expect(response.status).toBe(403);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:write'] });
  });

  it('drops allowAnonymous from the stored settings — every response is signed', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    createSurveyAssetMock.mockResolvedValue({ id: 'asset_3' });

    const response = await POST(
      jsonRequest({
        title: 'X',
        fields: [{ name: 'q1', type: 'text', title: 'Q1' }],
        settings: { allowAnonymous: true, multipleResponses: true, eventId: 'event_1' },
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.settings).toEqual({ multipleResponses: true, eventId: 'event_1' });
    expect(JSON.parse(createSurveyAssetMock.mock.calls[0][0].content).settings).toEqual({ multipleResponses: true, eventId: 'event_1' });
  });

  it.each([
    ['a non-object', 'nope'],
    ['an array', []],
    ['a non-boolean multipleResponses', { multipleResponses: 'yes' }],
    ['an empty eventId', { eventId: '' }],
  ])('rejects settings that are %s', async (_label, settings) => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });

    const response = await POST(jsonRequest({ title: 'X', fields: [{ name: 'q1', type: 'text', title: 'Q1' }], settings }) as never);

    expect(response.status).toBe(400);
    expect(createSurveyAssetMock).not.toHaveBeenCalled();
  });

  it('marks a draft survey private at creation — a draft is genuinely private, not merely unlisted', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    createSurveyAssetMock.mockResolvedValue({ id: 'asset_2' });

    await POST(jsonRequest({ title: 'Draft survey', fields: [{ name: 'q1', type: 'text', title: 'Q1' }] }) as never);

    const [createArgs] = createSurveyAssetMock.mock.calls[0];
    expect(createArgs.access).toBe('private');
  });

  it('rejects an unparseable JSON body', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    const request = new Request('https://dykil.imajin.ai/api/surveys', { method: 'POST', body: '{not json' });

    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });

  it('rejects invalid fields', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });

    const response = await POST(jsonRequest({ title: 'X', fields: [] }) as never);
    expect(response.status).toBe(400);
  });

  it('surfaces a KernelMediaError from the kernel as its own status', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    const { KernelMediaError } = await import('@/lib/kernel/media');
    createSurveyAssetMock.mockRejectedValue(new KernelMediaError('Kernel rejected', 502, null));

    const response = await POST(jsonRequest({ title: 'X', fields: [{ name: 'q1', type: 'text', title: 'Q1' }] }) as never);
    expect(response.status).toBe(502);
  });

  it('returns 500 when survey creation fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    createSurveyAssetMock.mockRejectedValue(new Error('boom'));

    const response = await POST(jsonRequest({ title: 'X', fields: [{ name: 'q1', type: 'text', title: 'Q1' }] }) as never);
    expect(response.status).toBe(500);
  });
});

describe('GET /api/surveys', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listMySurveyAssetsMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys') as never);
    expect(response.status).toBe(401);
    expect(listMySurveyAssetsMock).not.toHaveBeenCalled();
  });

  it('requires the dykil:read scope', async () => {
    authenticateMock.mockResolvedValue({ error: 'Missing required scope(s): dykil:read', status: 403 });

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys') as never);

    expect(response.status).toBe(403);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:read'] });
  });

  it("lists the caller's own surveys, same as /api/surveys/mine", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    listMySurveyAssetsMock.mockResolvedValue([{ id: 'asset_1' }]);
    readOwnerSurveyAssetMock.mockResolvedValue({ content: { schema: 'dykil.survey/v1', title: 'Mine' }, filename: 'f.json' });

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.surveys).toEqual([{ id: 'asset_1', schema: 'dykil.survey/v1', title: 'Mine' }]);
  });
});
