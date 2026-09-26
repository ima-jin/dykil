import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSurveyAsset,
  deleteSurveyAsset,
  KernelMediaError,
  listMySurveyAssets,
  readOwnerSurveyAsset,
  readPublicSurveyAsset,
  updateSurveyAsset,
} from '../media';

describe('kernel media client', () => {
  beforeEach(() => {
    process.env.MEDIA_SERVICE_URL = 'https://dev-jin.imajin.ai/media';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("createSurveyAsset forwards the caller's cookie/authorization headers, never its own credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'asset_1', ownerDid: 'did:imajin:owner' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://dykil.imajin.ai/api/surveys', {
      headers: { cookie: 'imajin_session=abc', authorization: 'Bearer app-token' },
    });

    const asset = await createSurveyAsset({ request, filename: 'dykil-survey-1.json', content: '{}', access: 'public' });

    expect(asset.id).toBe('asset_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ cookie: 'imajin_session=abc', authorization: 'Bearer app-token' });
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("createSurveyAsset throws KernelMediaError with the kernel's status on failure", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Not authenticated' }) }),
    );
    await expect(
      createSurveyAsset({ request: new Request('https://dykil.imajin.ai/api/surveys'), filename: 'f.json', content: '{}', access: 'private' }),
    ).rejects.toMatchObject({ status: 401, message: 'Not authenticated' });
  });

  it('readPublicSurveyAsset reads the public asset-serving endpoint (no auth), not /content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ title: 'Hi' }) });
    vi.stubGlobal('fetch', fetchMock);

    const content = await readPublicSurveyAsset('asset_1');

    expect(content).toEqual({ title: 'Hi' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets/asset_1');
    expect(init?.headers).toBeUndefined();
  });

  it('readPublicSurveyAsset returns null for 404/403 rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await readPublicSurveyAsset('missing')).toBeNull();
  });

  it('readOwnerSurveyAsset hits /content with forwarded identity headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: { title: 'Draft' }, filename: 'f.json' }) });
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://dykil.imajin.ai', { headers: { cookie: 'imajin_session=abc' } });
    const result = await readOwnerSurveyAsset('asset_1', request);

    expect(result?.content).toEqual({ title: 'Draft' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets/asset_1/content');
    expect(init.headers).toMatchObject({ cookie: 'imajin_session=abc' });
  });

  it('updateSurveyAsset PUTs new content with forwarded identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await updateSurveyAsset('asset_1', '{"title":"New"}', new Request('https://dykil.imajin.ai', { headers: { cookie: 'c=1' } }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets/asset_1/content');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"content":"{\\"title\\":\\"New\\"}"}');
  });

  it('deleteSurveyAsset DELETEs with forwarded identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await deleteSurveyAsset('asset_1', new Request('https://dykil.imajin.ai', { headers: { cookie: 'c=1' } }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets/asset_1');
    expect(init.method).toBe('DELETE');
  });

  it('listMySurveyAssets filters by the dykil-survey- filename convention (no context filter exists upstream)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [{ id: 'asset_1' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const assets = await listMySurveyAssets(new Request('https://dykil.imajin.ai'));

    expect(assets).toEqual([{ id: 'asset_1' }]);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('search')).toBe('dykil-survey-');
    expect(parsed.searchParams.get('type')).toBe('application');
  });

  it('KernelMediaError carries status and body for route handlers to relay', () => {
    const error = new KernelMediaError('boom', 500, { error: 'boom' });
    expect(error.status).toBe(500);
    expect(error.body).toEqual({ error: 'boom' });
  });
});
