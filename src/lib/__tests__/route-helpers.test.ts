import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readOwnerSurveyAssetMock } = vi.hoisted(() => ({
  readOwnerSurveyAssetMock: vi.fn(),
}));

vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, readOwnerSurveyAsset: readOwnerSurveyAssetMock };
});

import { KernelMediaError } from '@/lib/kernel/media';
import { handleSurveyRouteError, requireOwnedSurvey } from '@/lib/route-helpers';

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
