import { canonicalize } from '@ima-jin/auth';
import { authServiceUrl } from '@/lib/env';
import { collectPages } from '@/lib/async/paginate';

export interface AttestationInput {
  issuerDid: string;
  subjectDid: string;
  type: string;
  contextId: string;
  contextType: string;
  payload: Record<string, unknown>;
  signature: string;
  issuedAt: number;
  /**
   * Indexed, app-specific lookup key (imajin-ai#2534) — e.g. a `ticketId`.
   * Stored verbatim by the kernel and NOT part of the signed canonical form:
   * the signed `payload` stays the source of truth. At most 256 characters.
   */
  ref?: string | null;
}

/** Longest `ref` the kernel accepts. */
export const ATTESTATION_REF_MAX_LENGTH = 256;

export interface KernelAttestation {
  id: string;
  cid: string | null;
  issuerDid: string;
  subjectDid: string;
  type: string;
  contextId: string | null;
  contextType: string | null;
  ref?: string | null;
  payload: Record<string, unknown> | null;
  issuedAt: string;
}

export class KernelAttestationError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'KernelAttestationError';
    this.status = status;
    this.body = body;
  }
}

/**
 * The exact canonical form the kernel signs/verifies over
 * (`apps/kernel/app/auth/api/attestations/route.ts`). Exported so callers —
 * and, crucially, a genuine respondent-side signer — can reproduce the exact
 * bytes a signature must cover before this app ever sees it.
 */
export function canonicalAttestationPayload(input: Omit<AttestationInput, 'issuerDid' | 'signature'>): string {
  return canonicalize({
    subject_did: input.subjectDid,
    type: input.type,
    context_id: input.contextId ?? null,
    context_type: input.contextType ?? null,
    payload: input.payload ?? null,
    issued_at: input.issuedAt,
  });
}

/**
 * Relay an already-signed attestation to the kernel's public
 * `POST /api/attestations`. This app never produces the signature itself —
 * see src/lib/response-attestation.ts and FINDINGS.md gap #2394 for who does.
 */
export async function createAttestation(input: AttestationInput, callerHeaders?: HeadersInit): Promise<KernelAttestation> {
  const response = await fetch(`${authServiceUrl()}/api/attestations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...callerHeaders },
    body: JSON.stringify({
      issuer_did: input.issuerDid,
      subject_did: input.subjectDid,
      type: input.type,
      context_id: input.contextId,
      context_type: input.contextType,
      payload: input.payload,
      ...(input.ref ? { ref: input.ref } : {}),
      signature: input.signature,
      issued_at: input.issuedAt,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new KernelAttestationError((body as { error?: string } | null)?.error ?? 'Failed to create attestation', response.status, body);
  }
  return body as KernelAttestation;
}

/** Response header carrying the cursor for the next (older) page (imajin-ai#2533). */
const NEXT_CURSOR_HEADER = 'x-next-cursor';

export interface ListAttestationsParams {
  /** Required by the kernel — for a survey response, the survey owner. */
  subjectDid: string;
  type?: string;
  issuerDid?: string;
  /** Exact match on the indexed `context_id` (imajin-ai#2396) — the survey asset id. */
  contextId?: string;
  /** Exact match on the indexed `ref` (imajin-ai#2534) — e.g. a ticketId. */
  ref?: string;
  /** Opaque cursor from a previous page's `nextCursor`. */
  before?: string;
  limit?: number;
}

export interface AttestationPage {
  rows: KernelAttestation[];
  /** Present only when more (older) rows exist. */
  nextCursor: string | null;
}

/**
 * One page of non-revoked, non-superseded attestations for a subject DID,
 * newest first: `GET {kernel}/api/attestations`. The kernel pages by keyset
 * cursor (`before=<issued_at,id>`, imajin-ai#2533); the cursor for the next
 * page rides in the `X-Next-Cursor` response header and the body stays a bare
 * array.
 *
 * `callerHeaders` MUST be the inbound caller's own credentials (see
 * `forwardedIdentityHeaders`): response types are registered third-party
 * types, so the kernel gates reads by `disclosure_scope` (default `parties` —
 * the issuer and the subject). An anonymous read returns no rows.
 */
export async function listAttestationsPage(
  params: ListAttestationsParams,
  callerHeaders?: HeadersInit,
): Promise<AttestationPage> {
  const url = new URL(`${authServiceUrl()}/api/attestations`);
  url.searchParams.set('subject_did', params.subjectDid);
  url.searchParams.set('limit', String(params.limit ?? 100));
  if (params.type) url.searchParams.set('type', params.type);
  if (params.issuerDid) url.searchParams.set('issuer_did', params.issuerDid);
  if (params.contextId) url.searchParams.set('context_id', params.contextId);
  if (params.ref) url.searchParams.set('ref', params.ref);
  if (params.before) url.searchParams.set('before', params.before);

  const response = await fetch(url, { headers: callerHeaders, cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new KernelAttestationError((body as { error?: string } | null)?.error ?? 'Failed to list attestations', response.status, body);
  }
  return { rows: body as KernelAttestation[], nextCursor: response.headers?.get(NEXT_CURSOR_HEADER) ?? null };
}

/** Upper bound on the pages a single "list everything" walk will follow (100 rows each by default). */
const LIST_ALL_MAX_PAGES = 200;

/**
 * Every matching attestation, following the kernel's `X-Next-Cursor` until it
 * is exhausted — what an owner's full response export needs.
 */
export async function listAllAttestations(
  params: Omit<ListAttestationsParams, 'before'>,
  callerHeaders?: HeadersInit,
): Promise<KernelAttestation[]> {
  return collectPages<KernelAttestation, string>(async (cursor) => {
    const page = await listAttestationsPage({ ...params, before: cursor ?? undefined }, callerHeaders);
    return { items: page.rows, next: page.nextCursor };
  }, LIST_ALL_MAX_PAGES);
}

/**
 * Withdraw an attestation: `POST {kernel}/api/attestations/{id}/revoke`
 * (imajin-ai#2649). Issuer-only — the kernel answers 403 for anyone else, 404
 * for an unknown id and 409 when it is already revoked. A revoked attestation
 * drops out of the default list read.
 */
export async function revokeAttestation(id: string, callerHeaders?: HeadersInit): Promise<{ id: string; revokedAt: string }> {
  const response = await fetch(`${authServiceUrl()}/api/attestations/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: callerHeaders,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new KernelAttestationError((body as { error?: string } | null)?.error ?? 'Failed to revoke attestation', response.status, body);
  }
  return body as { id: string; revokedAt: string };
}
