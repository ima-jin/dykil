import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveHandleMock, listPublicMock, readPublicMock } = vi.hoisted(() => ({
  resolveHandleMock: vi.fn(),
  listPublicMock: vi.fn(),
  readPublicMock: vi.fn(),
}));

vi.mock('@/lib/kernel/profile', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/profile')>('@/lib/kernel/profile');
  return { ...actual, resolveHandleToDid: resolveHandleMock };
});
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, listPublicSurveyAssets: listPublicMock, readPublicSurveyAsset: readPublicMock };
});

import { KernelMediaError } from '@/lib/kernel/media';
import { KernelProfileError } from '@/lib/kernel/profile';
import { GET, OPTIONS } from '../route';

const OWNER = 'did:imajin:alice';
const survey = (overrides: Record<string, unknown> = {}) => ({
  schema: 'dykil.survey/v1',
  ownerDid: OWNER,
  title: 'Feedback',
  description: 'Tell us',
  fields: { elements: [] },
  settings: {},
  type: 'survey',
  status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const request = () => new Request('https://dykil.imajin.ai/api/surveys/handle/alice', { headers: { cookie: 'imajin_session=abc' } });
const call = () => GET(request() as never, { params: Promise.resolve({ handle: 'alice' }) });

describe('OPTIONS /api/surveys/handle/:handle', () => {
  it('returns the shared CORS preflight response', async () => {
    expect((await OPTIONS(request() as never)).status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/handle/:handle', () => {
  beforeEach(() => {
    resolveHandleMock.mockReset().mockResolvedValue(OWNER);
    listPublicMock.mockReset();
    readPublicMock.mockReset();
  });

  it("lists the handle's published surveys: handle -> DID via the public profile API, then that DID's public assets", async () => {
    listPublicMock.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    readPublicMock.mockImplementation(async (id: string) => (id === 'a1' ? survey() : survey({ title: 'Second', description: null })));

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      handle: 'alice',
      surveys: [
        { id: 'a1', title: 'Feedback', description: 'Tell us', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a2', title: 'Second', description: null, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(resolveHandleMock).toHaveBeenCalledWith('alice');
    expect(listPublicMock).toHaveBeenCalledWith(OWNER, expect.any(Request));
  });

  it.each([
    ['a draft', survey({ status: 'draft' })],
    ['a closed survey', survey({ status: 'closed' })],
    ['a document owned by someone else', survey({ ownerDid: 'did:imajin:mallory' })],
    ['an asset that is not a survey document', { schema: 'something/else' }],
    ['an unreadable (private) asset', null],
  ])('never lists %s', async (_label, content) => {
    listPublicMock.mockResolvedValue([{ id: 'a1' }]);
    readPublicMock.mockResolvedValue(content);
    expect((await (await call()).json()).surveys).toEqual([]);
  });

  it('returns an empty list for a handle with no surveys', async () => {
    listPublicMock.mockResolvedValue([]);
    expect(await (await call()).json()).toEqual({ handle: 'alice', surveys: [] });
  });

  it('answers 404 for an unknown handle without listing anything', async () => {
    resolveHandleMock.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(listPublicMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a media failure (e.g. an anonymous caller)', new KernelMediaError('Not authenticated', 401, null), 401],
    ['a profile failure', new KernelProfileError('Profile lookup failed (503)', 503), 503],
  ])('passes %s through with its status', async (_label, failure, status) => {
    listPublicMock.mockRejectedValue(failure);
    resolveHandleMock.mockImplementation(async () => {
      if (failure instanceof KernelProfileError) throw failure;
      return OWNER;
    });
    expect((await call()).status).toBe(status);
  });

  it('answers 500 for an unexpected failure', async () => {
    resolveHandleMock.mockRejectedValue(new Error('boom'));
    expect((await call()).status).toBe(500);
  });
});
