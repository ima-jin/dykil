import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalize } from '@ima-jin/auth';
import {
  canonicalAttestationPayload,
  createAttestation,
  KernelAttestationError,
  listAllAttestations,
  listAttestationsPage,
  revokeAttestation,
} from '../attestations';

function listResponse(rows: unknown[], nextCursor?: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
    json: async () => rows,
  };
}

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

  it('sends the indexed ref (outside the signed bytes) and the caller credentials when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'att_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await createAttestation(
      {
        issuerDid: 'did:imajin:respondent',
        subjectDid: 'did:imajin:owner',
        type: 'dykil/survey-response',
        contextId: 'asset_1',
        contextType: 'dykil.survey',
        payload: {},
        signature: 'sig',
        issuedAt: 1,
        ref: 'tkt_1',
      },
      { authorization: 'Bearer caller-token' },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).ref).toBe('tkt_1');
    expect(init.headers).toMatchObject({ authorization: 'Bearer caller-token', 'Content-Type': 'application/json' });
  });

  it('omits ref from the body when there is none', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'att_1' }) });
    vi.stubGlobal('fetch', fetchMock);

    await createAttestation({
      issuerDid: 'did:imajin:respondent',
      subjectDid: 'did:imajin:owner',
      type: 'dykil/survey-response',
      contextId: 'asset_1',
      contextType: 'dykil.survey',
      payload: {},
      signature: 'sig',
      issuedAt: 1,
      ref: null,
    });

    expect('ref' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
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

describe('listAttestationsPage', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queries by subject_did + context_id and every optional filter, forwarding the caller credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await listAttestationsPage(
      {
        subjectDid: 'did:imajin:owner',
        type: 'dykil/survey-response',
        issuerDid: 'did:imajin:respondent',
        contextId: 'asset_1',
        ref: 'tkt_1',
        before: '2026-01-01T00:00:00.000Z,att_9',
        limit: 25,
      },
      { authorization: 'Bearer caller-token' },
    );

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/auth/api/attestations');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      subject_did: 'did:imajin:owner',
      type: 'dykil/survey-response',
      issuer_did: 'did:imajin:respondent',
      context_id: 'asset_1',
      ref: 'tkt_1',
      before: '2026-01-01T00:00:00.000Z,att_9',
      limit: '25',
    });
    expect(init.headers).toEqual({ authorization: 'Bearer caller-token' });
  });

  it('sends only subject_did and the default limit when nothing else is asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([{ id: 'att_1' }]));
    vi.stubGlobal('fetch', fetchMock);

    const page = await listAttestationsPage({ subjectDid: 'did:imajin:owner' });

    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({
      subject_did: 'did:imajin:owner',
      limit: '100',
    });
    expect(page).toEqual({ rows: [{ id: 'att_1' }], nextCursor: null });
  });

  it('returns the kernel X-Next-Cursor header as nextCursor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([{ id: 'att_1' }], '2026-01-01T00:00:00.000Z,att_1')));
    const page = await listAttestationsPage({ subjectDid: 'did:imajin:owner' });
    expect(page.nextCursor).toBe('2026-01-01T00:00:00.000Z,att_1');
  });

  it('treats a response without headers as the last page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    expect((await listAttestationsPage({ subjectDid: 'did:imajin:owner' })).nextCursor).toBeNull();
  });

  it('throws KernelAttestationError on a failed list call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'before must be <issued_at,id>' }) }));
    await expect(listAttestationsPage({ subjectDid: 'did:imajin:owner', before: 'bad' })).rejects.toMatchObject({
      status: 400,
      message: 'before must be <issued_at,id>',
    });
  });

  it('falls back to a generic message when the kernel error has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error('not json')) }));
    await expect(listAttestationsPage({ subjectDid: 'did:imajin:owner' })).rejects.toBeInstanceOf(KernelAttestationError);
  });
});

describe('listAllAttestations', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows X-Next-Cursor as the before cursor until the kernel stops sending one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listResponse([{ id: 'att_3' }, { id: 'att_2' }], 'c2'))
      .mockResolvedValueOnce(listResponse([{ id: 'att_1' }], 'c1'))
      .mockResolvedValueOnce(listResponse([{ id: 'att_0' }]));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await listAllAttestations({ subjectDid: 'did:imajin:owner', contextId: 'asset_1' }, { authorization: 'Bearer t' });

    expect(rows.map((row) => row.id)).toEqual(['att_3', 'att_2', 'att_1', 'att_0']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const befores = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('before'));
    expect(befores).toEqual([null, 'c2', 'c1']);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).toEqual({ authorization: 'Bearer t' });
    }
  });

  it('stops when the kernel repeats a cursor instead of spinning', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listResponse([{ id: 'a' }], 'same'))
      .mockResolvedValue(listResponse([{ id: 'b' }], 'same'));
    vi.stubGlobal('fetch', fetchMock);

    const rows = await listAllAttestations({ subjectDid: 'did:imajin:owner' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it('propagates a kernel failure mid-walk', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(listResponse([{ id: 'a' }], 'c1'))
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Failed to query attestations' }) }),
    );
    await expect(listAllAttestations({ subjectDid: 'did:imajin:owner' })).rejects.toMatchObject({ status: 500 });
  });
});

describe('revokeAttestation', () => {
  beforeEach(() => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/attestations/{id}/revoke with the caller credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'att_1', revokedAt: '2026-01-01T00:00:00.000Z' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeAttestation('att 1', { authorization: 'Bearer t' });

    expect(result).toEqual({ id: 'att_1', revokedAt: '2026-01-01T00:00:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev-jin.imajin.ai/auth/api/attestations/att%201/revoke');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer t' });
  });

  it.each([
    [403, 'Only the attestation issuer can revoke'],
    [404, 'Attestation not found'],
    [409, 'Attestation is already revoked'],
  ])('surfaces the kernel %i as KernelAttestationError', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: message }) }));
    await expect(revokeAttestation('att_1')).rejects.toMatchObject({ status, message });
  });

  it('uses a generic message when the kernel sends no error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => Promise.reject(new Error('x')) }));
    await expect(revokeAttestation('att_1')).rejects.toMatchObject({ status: 500, message: 'Failed to revoke attestation' });
  });
});
