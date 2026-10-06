import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSurveyAsset,
  deleteSurveyAsset,
  KernelMediaError,
  listMySurveyAssets,
  readOwnerSurveyAsset,
  readPublicSurveyAsset,
  setSurveyAssetAccess,
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

  it('createSurveyAsset stores the survey under the dykil/survey upload context with the requested access', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await createSurveyAsset({ request: new Request('https://dykil.imajin.ai'), filename: 'f.json', content: '{}', access: 'private' });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(JSON.parse(String(form.get('context')))).toEqual({ app: 'dykil', feature: 'survey', access: 'private' });
  });

  it('setSurveyAssetAccess PATCHes /access with the new level and forwarded identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'asset_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const asset = await setSurveyAssetAccess(
      'asset 1',
      'public',
      new Request('https://dykil.imajin.ai', { headers: { authorization: 'Bearer t' } }),
    );

    expect(asset.id).toBe('asset_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/media/api/assets/asset%201/access');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({ authorization: 'Bearer t', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ access: 'public' });
  });

  it('setSurveyAssetAccess surfaces a kernel refusal as KernelMediaError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }));
    await expect(setSurveyAssetAccess('asset_1', 'private', new Request('https://dykil.imajin.ai'))).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    });
  });

  it('listMySurveyAssets filters by the dykil/survey upload context and forwards identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [{ id: 'asset_1' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const assets = await listMySurveyAssets(new Request('https://dykil.imajin.ai', { headers: { authorization: 'Bearer t' } }));

    expect(assets).toEqual([{ id: 'asset_1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/media/api/assets');
    expect(parsed.searchParams.get('context_app')).toBe('dykil');
    expect(parsed.searchParams.get('context_feature')).toBe('survey');
    expect(parsed.searchParams.has('search')).toBe(false);
    expect(init.headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it('listMySurveyAssets pages by offset while pages come back full, then stops', async () => {
    const fullPage = Array.from({ length: 200 }, (_, index) => ({ id: `asset_${index}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ assets: fullPage }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ assets: [{ id: 'last' }] }) });
    vi.stubGlobal('fetch', fetchMock);

    const assets = await listMySurveyAssets(new Request('https://dykil.imajin.ai'));

    expect(assets).toHaveLength(201);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('offset')).toBe('0');
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('offset')).toBe('200');
  });

  it('listMySurveyAssets surfaces a kernel failure as KernelMediaError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Missing required scope: media:read' }) }));
    await expect(listMySurveyAssets(new Request('https://dykil.imajin.ai'))).rejects.toMatchObject({ status: 403 });
  });

  it('KernelMediaError carries status and body for route handlers to relay', () => {
    const error = new KernelMediaError('boom', 500, { error: 'boom' });
    expect(error.status).toBe(500);
    expect(error.body).toEqual({ error: 'boom' });
  });
});
