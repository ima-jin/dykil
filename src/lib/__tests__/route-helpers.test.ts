import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readOwnerSurveyAssetMock, readPublicSurveyAssetMock, setSurveyAssetAccessMock, updateSurveyAssetMock } = vi.hoisted(() => ({
  readOwnerSurveyAssetMock: vi.fn(),
  readPublicSurveyAssetMock: vi.fn(),
  setSurveyAssetAccessMock: vi.fn(),
  updateSurveyAssetMock: vi.fn(),
}));

vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return {
    ...actual,
    readOwnerSurveyAsset: readOwnerSurveyAssetMock,
    readPublicSurveyAsset: readPublicSurveyAssetMock,
    setSurveyAssetAccess: setSurveyAssetAccessMock,
    updateSurveyAsset: updateSurveyAssetMock,
  };
});

import { KernelMediaError } from '@/lib/kernel/media';
import { handleSurveyRouteError, loadSurveyDoc, persistSurveyUpdate, requireOwnedSurvey } from '@/lib/route-helpers';
import type { SurveyDoc } from '@/lib/survey';

const doc = {
  schema: 'dykil.survey/v1',
  ownerDid: 'did:imajin:owner',
  title: 'Feedback',
  description: null,
  fields: { elements: [] },
  settings: {},
  type: 'survey',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('requireOwnedSurvey', () => {
  beforeEach(() => {
    readOwnerSurveyAssetMock.mockReset();
  });

  it('returns a 404 response when the survey does not exist', async () => {
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    const result = await requireOwnedSurvey('asset_1', 'did:imajin:owner', new Request('https://x') as never, {}, 'nope');
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(404);
    }
  });

  it('returns a 404 response when the asset content is not a valid survey doc', async () => {
    readOwnerSurveyAssetMock.mockResolvedValue({ content: { not: 'a survey' }, filename: 'f.json' });

    const result = await requireOwnedSurvey('asset_1', 'did:imajin:owner', new Request('https://x') as never, {}, 'nope');
    expect('response' in result && result.response.status).toBe(404);
  });

  it('returns a 403 response when the caller does not own the survey', async () => {
    readOwnerSurveyAssetMock.mockResolvedValue({ content: doc, filename: 'f.json' });

    const result = await requireOwnedSurvey('asset_1', 'did:imajin:someone-else', new Request('https://x') as never, {}, 'Not authorized');
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
      expect((await result.response.json()).error).toBe('Not authorized');
    }
  });

  it('returns the survey when the caller owns it', async () => {
    readOwnerSurveyAssetMock.mockResolvedValue({ content: doc, filename: 'f.json' });

    const result = await requireOwnedSurvey('asset_1', 'did:imajin:owner', new Request('https://x') as never, {}, 'nope');
    expect('survey' in result).toBe(true);
    if ('survey' in result) {
      expect(result.survey).toEqual(doc);
    }
  });
});

describe('handleSurveyRouteError', () => {
  it("surfaces a KernelMediaError's own status and message", async () => {
    const response = handleSurveyRouteError(new KernelMediaError('Asset gone', 410, null), {}, 'Failed to do the thing');
    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe('Asset gone');
  });

  it('falls back to a 500 with the given message for any other error', async () => {
    const response = handleSurveyRouteError(new Error('boom'), {}, 'Failed to do the thing');
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to do the thing');
  });
});

describe('loadSurveyDoc', () => {
  beforeEach(() => {
    readOwnerSurveyAssetMock.mockReset();
    readPublicSurveyAssetMock.mockReset();
  });

  it('returns the public document without ever trying the owner read', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(doc);

    expect(await loadSurveyDoc('asset_1', new Request('https://x'))).toEqual(doc);
    expect(readOwnerSurveyAssetMock).not.toHaveBeenCalled();
  });

  it('falls back to the caller\'s owner read for a private (draft/closed) survey', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue({ content: { ...doc, status: 'draft' }, filename: 'f.json' });

    const loaded = await loadSurveyDoc('asset_1', new Request('https://x'));

    expect(loaded?.status).toBe('draft');
  });

  it('ignores public content that is not a survey document', async () => {
    readPublicSurveyAssetMock.mockResolvedValue({ not: 'a survey' });
    readOwnerSurveyAssetMock.mockResolvedValue(null);

    expect(await loadSurveyDoc('asset_1', new Request('https://x'))).toBeNull();
  });

  it('treats an owner-read failure as not found', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockRejectedValue(new KernelMediaError('Not authenticated', 401, null));

    expect(await loadSurveyDoc('asset_1', new Request('https://x'))).toBeNull();
  });

  it('returns null when the owner read yields something that is not a survey document', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue({ content: { not: 'a survey' }, filename: 'f.json' });

    expect(await loadSurveyDoc('asset_1', new Request('https://x'))).toBeNull();
  });
});

describe('persistSurveyUpdate', () => {
  const request = new Request('https://x');
  const published = doc as SurveyDoc;
  const draft = { ...doc, status: 'draft' } as SurveyDoc;

  beforeEach(() => {
    setSurveyAssetAccessMock.mockReset().mockResolvedValue({});
    updateSurveyAssetMock.mockReset().mockResolvedValue({ ok: true });
  });

  it('writes content then flips public when a draft is published', async () => {
    const order: string[] = [];
    updateSurveyAssetMock.mockImplementation(async () => order.push('content'));
    setSurveyAssetAccessMock.mockImplementation(async (_id: string, access: string) => order.push(access));

    await persistSurveyUpdate('asset_1', draft, published, request);

    expect(order).toEqual(['content', 'public']);
    expect(updateSurveyAssetMock).toHaveBeenCalledWith('asset_1', JSON.stringify(published), request);
    expect(setSurveyAssetAccessMock).toHaveBeenCalledWith('asset_1', 'public', request);
  });

  it('flips private then writes content when a published survey is unpublished', async () => {
    const order: string[] = [];
    updateSurveyAssetMock.mockImplementation(async () => order.push('content'));
    setSurveyAssetAccessMock.mockImplementation(async (_id: string, access: string) => order.push(access));

    await persistSurveyUpdate('asset_1', published, draft, request);

    expect(order).toEqual(['private', 'content']);
  });

  it('only writes content when the public/private state does not change', async () => {
    await persistSurveyUpdate('asset_1', published, { ...published, title: 'New' }, request);
    await persistSurveyUpdate('asset_1', draft, { ...draft, status: 'closed' }, request);

    expect(setSurveyAssetAccessMock).not.toHaveBeenCalled();
    expect(updateSurveyAssetMock).toHaveBeenCalledTimes(2);
  });

  it('does not write content when going private fails, so the document is never left public-but-closed', async () => {
    setSurveyAssetAccessMock.mockRejectedValue(new KernelMediaError('Forbidden', 403, null));

    await expect(persistSurveyUpdate('asset_1', published, draft, request)).rejects.toMatchObject({ status: 403 });
    expect(updateSurveyAssetMock).not.toHaveBeenCalled();
  });

  it('does not flip public when the content write fails, so a half-written survey is never exposed', async () => {
    updateSurveyAssetMock.mockRejectedValue(new KernelMediaError('Storage failure', 500, null));

    await expect(persistSurveyUpdate('asset_1', draft, published, request)).rejects.toMatchObject({ status: 500 });
    expect(setSurveyAssetAccessMock).not.toHaveBeenCalled();
  });
});
