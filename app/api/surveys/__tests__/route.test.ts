import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, createSurveyAssetMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  createSurveyAssetMock: vi.fn(),
}));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, createSurveyAsset: createSurveyAssetMock };
});

import { POST } from '../route';

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

  it('marks a draft survey private (unlisted) at creation', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    createSurveyAssetMock.mockResolvedValue({ id: 'asset_2' });

    await POST(jsonRequest({ title: 'Draft survey', fields: [{ name: 'q1', type: 'text', title: 'Q1' }] }) as never);

    const [createArgs] = createSurveyAssetMock.mock.calls[0];
    expect(createArgs.access).toBe('private');
  });
});
