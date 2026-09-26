import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticateMock, readPublicSurveyAssetMock, readOwnerSurveyAssetMock, updateSurveyAssetMock, deleteSurveyAssetMock } =
  vi.hoisted(() => ({
    authenticateMock: vi.fn(),
    readPublicSurveyAssetMock: vi.fn(),
    readOwnerSurveyAssetMock: vi.fn(),
    updateSurveyAssetMock: vi.fn(),
    deleteSurveyAssetMock: vi.fn(),
  }));

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return {
    ...actual,
    readPublicSurveyAsset: readPublicSurveyAssetMock,
    readOwnerSurveyAsset: readOwnerSurveyAssetMock,
    updateSurveyAsset: updateSurveyAssetMock,
    deleteSurveyAsset: deleteSurveyAssetMock,
  };
});

import { DELETE, GET, OPTIONS, PUT } from '../route';

const publishedDoc = {
  schema: 'dykil.survey/v1',
  ownerDid: 'did:imajin:owner',
  title: 'Published survey',
  description: null,
  fields: { elements: [] },
  settings: {},
  type: 'survey',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const draftDoc = { ...publishedDoc, status: 'draft' };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('OPTIONS /api/surveys/:id', () => {
  it('returns the shared CORS preflight response', async () => {
    const response = await OPTIONS(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never);
    expect(response.status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/:id', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readPublicSurveyAssetMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
  });

  it('returns a published survey to an anonymous caller', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    readPublicSurveyAssetMock.mockResolvedValue(publishedDoc);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe('Published survey');
  });

  it('404s a draft survey for a non-owner', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:someone-else', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(draftDoc);
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never, params('asset_1'));
    expect(response.status).toBe(404);
  });

  it("shows a draft survey to its owner via the authenticated content read", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue({ content: draftDoc, filename: 'f.json' });

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('draft');
  });

  it('404s when the survey does not exist at all', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    readPublicSurveyAssetMock.mockResolvedValue(null);

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/missing') as never, params('missing'));
    expect(response.status).toBe(404);
  });

  it("falls through to 404 when the owner-read fails with the app-token gap (KernelMediaError)", async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockRejectedValue(new (await import('@/lib/kernel/media')).KernelMediaError('nope', 401, null));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never, params('asset_1'));
    expect(response.status).toBe(404);
  });

  it('returns 500 when the owner-read fails with an unexpected error', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockRejectedValue(new Error('boom'));

    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/asset_1') as never, params('asset_1'));
    expect(response.status).toBe(500);
  });
});

describe('PUT /api/surveys/:id', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
    updateSurveyAssetMock.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'New title' }),
    });
    const response = await PUT(request as never, params('asset_1'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when the caller is not the owner', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:someone-else', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'New title' }),
    });
    const response = await PUT(request as never, params('asset_1'));
    expect(response.status).toBe(403);
  });

  it('updates the survey document when the caller owns it', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });
    updateSurveyAssetMock.mockResolvedValue({ ok: true });

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'Updated title', status: 'closed' }),
    });
    const response = await PUT(request as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.title).toBe('Updated title');
    expect(body.status).toBe('closed');
    const [, uploadedContent] = updateSurveyAssetMock.mock.calls[0];
    expect(JSON.parse(uploadedContent).title).toBe('Updated title');
  });

  it('updates the fields when valid SurveyJS elements are provided', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });
    updateSurveyAssetMock.mockResolvedValue({ ok: true });

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ fields: [{ name: 'q1', type: 'text', title: 'Q1' }] }),
    });
    const response = await PUT(request as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fields).toEqual({ elements: [{ name: 'q1', type: 'text', title: 'Q1' }] });
  });

  it('rejects an update with invalid fields', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ fields: [] }),
    });
    const response = await PUT(request as never, params('asset_1'));
    expect(response.status).toBe(400);
    expect(updateSurveyAssetMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the update fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });
    updateSurveyAssetMock.mockRejectedValue(new Error('boom'));

    const request = new Request('https://dykil.imajin.ai/api/surveys/asset_1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'New title' }),
    });
    const response = await PUT(request as never, params('asset_1'));
    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/surveys/:id', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    readOwnerSurveyAssetMock.mockReset();
    deleteSurveyAssetMock.mockReset();
  });

  it('returns 401 when unauthenticated', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });

    const response = await DELETE(new Request('https://dykil.imajin.ai/api/surveys/asset_1', { method: 'DELETE' }) as never, params('asset_1'));
    expect(response.status).toBe(401);
  });

  it('returns 403 when the caller is not the owner', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:someone-else', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });

    const response = await DELETE(new Request('https://dykil.imajin.ai/api/surveys/asset_1', { method: 'DELETE' }) as never, params('asset_1'));
    expect(response.status).toBe(403);
  });

  it('deletes the survey document when the caller owns it', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });
    deleteSurveyAssetMock.mockResolvedValue({ ok: true });

    const response = await DELETE(new Request('https://dykil.imajin.ai/api/surveys/asset_1', { method: 'DELETE' }) as never, params('asset_1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true });
  });

  it('returns 500 when the delete fails unexpectedly', async () => {
    authenticateMock.mockResolvedValue({ auth: { did: 'did:imajin:owner', scopes: [], via: 'token' } });
    readOwnerSurveyAssetMock.mockResolvedValue({ content: publishedDoc, filename: 'f.json' });
    deleteSurveyAssetMock.mockRejectedValue(new Error('boom'));

    const response = await DELETE(new Request('https://dykil.imajin.ai/api/surveys/asset_1', { method: 'DELETE' }) as never, params('asset_1'));
    expect(response.status).toBe(500);
  });
});
