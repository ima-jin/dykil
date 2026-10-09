import { randomUUID } from 'node:crypto';
import { signBootstrapPayload } from '@ima-jin/auth-client';
import { appDid, authServiceUrl } from '@/lib/env';
import { getSigningIdentity } from '@/lib/auth/signing-identity';

/** Refresh a cached token this long before the kernel says it expires. */
export const EXPIRY_SKEW_MS = 30_000;

export interface MintedAppToken {
  token: string;
  expiresAtMs: number;
}

/** A kernel mint endpoint, relative to the auth service base URL. */
export type AppTokenEndpoint = 'apps/token' | 'apps/token/service';

export interface MintAppTokenParams {
  /**
   * `apps/token` — the proof-of-possession flow bound to an `app.authorized`
   * attestation (`attestationId` required, `scope` optional).
   * `apps/token/service` — the app authenticating as itself, no user
   * delegation and no attestation: `sub` is the app DID.
   */
  endpoint: AppTokenEndpoint;
  attestationId?: string;
  scope?: string;
  /** Builds the caller's own error type from a value-free message. */
  fail: (message: string) => Error;
  /** What the caller calls this token, for the generic refusal message. */
  label: string;
}

/**
 * Mints a short-lived scoped app token with this app's OWN vault-held signing
 * key (never a respondent's, never the kernel's): the app signs
 * `${appDid}[:${attestationId}]:${nonce}:${timestamp}` and the kernel verifies
 * that proof of possession against the key registered for the app DID
 * (AGENTS.md §2). The only SDK primitives used are `signBootstrapPayload` and
 * the identity `loadAppSigningKey()` cached by `signing-identity.ts`.
 *
 * Shared by the runtime (events ticket gate, `events-gate-token.ts`) and
 * `scripts/import-legacy.ts` (`app-service-token.ts`). Never logs or returns
 * key material — only the minted token.
 */
export async function mintAppToken(params: MintAppTokenParams): Promise<MintedAppToken> {
  const identity = getSigningIdentity();
  const did = appDid() ?? identity.appDid;
  const nonce = randomUUID().replaceAll('-', '');
  const timestamp = new Date().toISOString();
  const challengeParts = params.attestationId ? [did, params.attestationId, nonce, timestamp] : [did, nonce, timestamp];
  const signature = signBootstrapPayload(challengeParts.join(':'), identity.privateKey);

  const response = await fetch(`${authServiceUrl()}/api/${params.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appDid: did,
      ...(params.attestationId ? { attestationId: params.attestationId } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
      nonce,
      timestamp,
      signature,
    }),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => null)) as { token?: string; expiresIn?: number; error?: string } | null;
  if (!response.ok || !body?.token) {
    throw params.fail(body?.error ?? `Kernel refused to mint the ${params.label} (${response.status})`);
  }
  return { token: body.token, expiresAtMs: Date.now() + (body.expiresIn ?? 0) * 1000 };
}
