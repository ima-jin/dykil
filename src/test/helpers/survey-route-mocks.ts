import { vi } from 'vitest';

/**
 * Shared mock scaffolding for the /api/surveys/:id/responses* routes. Both
 * `responses/__tests__/route.test.ts` and `responses/check/__tests__/route.test.ts`
 * exercise the exact same "resolve survey doc, check ownership/access,
 * query attestations" shape, so this lives in one place instead of being
 * copy-pasted per test file.
 */
// `vi.mock` factories below are hoisted to the top of this module by
// vitest's transform, but the factories themselves only run lazily (when a
// dependent module is actually resolved) — by which time these plain
// `vi.fn()` consts are already initialized, so no `vi.hoisted()` wrapper is
// needed here (and directly exporting a hoisted destructure isn't supported
// by vitest's transform across module boundaries).
export const authenticateMock = vi.fn();
export const readPublicSurveyAssetMock = vi.fn();
export const readOwnerSurveyAssetMock = vi.fn();
export const listAttestationsMock = vi.fn();

vi.mock('@/lib/auth/authenticate', () => ({ authenticate: authenticateMock }));
vi.mock('@/lib/kernel/media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/media')>('@/lib/kernel/media');
  return { ...actual, readPublicSurveyAsset: readPublicSurveyAssetMock, readOwnerSurveyAsset: readOwnerSurveyAssetMock };
});
vi.mock('@/lib/kernel/attestations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kernel/attestations')>('@/lib/kernel/attestations');
  return { ...actual, listAttestations: listAttestationsMock };
});

export function resetSurveyRouteMocks(): void {
  authenticateMock.mockReset();
  readPublicSurveyAssetMock.mockReset();
  readOwnerSurveyAssetMock.mockReset();
  listAttestationsMock.mockReset();
}

export const publishedSurveyDocFixture = {
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

export function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
