import { canonicalize } from '@ima-jin/auth';
import { authServiceUrl } from '@/lib/env';

export interface AttestationInput {
  issuerDid: string;
  subjectDid: string;
  type: string;
  contextId: string;
  contextType: string;
  payload: Record<string, unknown>;
  signature: string;
  issuedAt: number;
}

export interface KernelAttestation {
  id: string;
  cid: string | null;
  issuerDid: string;
  subjectDid: string;
  type: string;
  contextId: string | null;
  contextType: string | null;
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

/**
 * List non-revoked attestations for a subject DID + type, paginating up to
 * `maxPages` of `limit` each. There is no `context_id` query parameter on the
 * public `GET /api/attestations` (only `subject_did`, `type`, `issuer_did`,
 * `status`), so narrowing to a single survey's responses is a client-side
 * filter over this — see FINDINGS.md gap #2396.
 */
export async function listAttestations(params: {
  subjectDid: string;
  type: string;
  issuerDid?: string;
  limit?: number;
  maxPages?: number;
}): Promise<KernelAttestation[]> {
  const limit = params.limit ?? 100;
  const maxPages = params.maxPages ?? 5;
  const all: KernelAttestation[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${authServiceUrl()}/api/attestations`);
    url.searchParams.set('subject_did', params.subjectDid);
    url.searchParams.set('type', params.type);
    url.searchParams.set('limit', String(limit));
    if (params.issuerDid) url.searchParams.set('issuer_did', params.issuerDid);

    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new KernelAttestationError((body as { error?: string } | null)?.error ?? 'Failed to list attestations', response.status, body);
    }
    const rows = body as KernelAttestation[];
    all.push(...rows);
    if (rows.length < limit) break;
  }

  return all;
}
