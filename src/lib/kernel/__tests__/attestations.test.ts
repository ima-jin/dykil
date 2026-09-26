import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalize } from '@ima-jin/auth';
import { canonicalAttestationPayload, createAttestation, KernelAttestationError, listAttestations } from '../attestations';

describe('canonicalAttestationPayload', () => {
  it('matches the exact canonical form the kernel signs/verifies over', () => {
    const canonical = canonicalAttestationPayload({
      subjectDid: 'did:imajin:owner',
      type: 'dykil/survey-response',
      contextId: 'asset_1',
      contextType: 'dykil.survey',
      payload: { answers: { q1: 'yes' } },
      issuedAt: 1_700_000_000_000,
    });
    expect(canonical).toBe(
      canonicalize({
        subject_did: 'did:imajin:owner',
        type: 'dykil/survey-response',
        context_id: 'asset_1',
        context_type: 'dykil.survey',
        payload: { answers: { q1: 'yes' } },
        issued_at: 1_700_000_000_000,
      }),
    );
  });
});

describe('createAttestation', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('relays an already-signed attestation to POST {kernel}/api/attestations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'att_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createAttestation({
      issuerDid: 'did:imajin:respondent',
      subjectDid: 'did:imajin:owner',
      type: 'dykil/survey-response',
      contextId: 'asset_1',
      contextType: 'dykil.survey',
      payload: { answers: {} },
      signature: 'sig',
      issuedAt: 1_700_000_000_000,
    });

    expect(result).toEqual({ id: 'att_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/auth/api/attestations');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      issuer_did: 'did:imajin:respondent',
      subject_did: 'did:imajin:owner',
      type: 'dykil/survey-response',
      context_id: 'asset_1',
      context_type: 'dykil.survey',
      signature: 'sig',
      issued_at: 1_700_000_000_000,
    });
  });

  it('throws KernelAttestationError when the kernel rejects the attestation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Invalid signature' }) }));
    await expect(
      createAttestation({
        issuerDid: 'did:imajin:respondent',
        subjectDid: 'did:imajin:owner',
        type: 'dykil/survey-response',
        contextId: 'asset_1',
        contextType: 'dykil.survey',
        payload: {},
        signature: 'bad',
        issuedAt: 1,
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Invalid signature' });
  });
});

describe('listAttestations', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries by subject_did + type, and issuer_did when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    await listAttestations({ subjectDid: 'did:imajin:owner', type: 'dykil/survey-response', issuerDid: 'did:imajin:respondent' });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/auth/api/attestations');
    expect(parsed.searchParams.get('subject_did')).toBe('did:imajin:owner');
    expect(parsed.searchParams.get('type')).toBe('dykil/survey-response');
    expect(parsed.searchParams.get('issuer_did')).toBe('did:imajin:respondent');
  });

  it('paginates while a full page keeps coming back, and stops once a short page arrives', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `att_${i}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page(2) })
      .mockResolvedValueOnce({ ok: true, json: async () => page(1) });
    vi.stubGlobal('fetch', fetchMock);

    const results = await listAttestations({ subjectDid: 'did:imajin:owner', type: 't', limit: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(3);
  });

  it('caps pagination at maxPages even if every page is full', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'a' }, { id: 'b' }] });
    vi.stubGlobal('fetch', fetchMock);

    const results = await listAttestations({ subjectDid: 'did:imajin:owner', type: 't', limit: 2, maxPages: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(6);
  });

  it('throws KernelAttestationError on a failed list call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'subject_did required' }) }));
    await expect(listAttestations({ subjectDid: '', type: 't' })).rejects.toBeInstanceOf(KernelAttestationError);
  });
});
