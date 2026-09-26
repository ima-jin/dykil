import { requireSessionOrAppToken } from '@ima-jin/auth';
import { thisAppHost } from '@/lib/env';

/**
 * This app's entire inbound-auth surface, deliberately funneled through one
 * function. Every route calls `authenticate(request)` and nothing else —
 * no route imports `@ima-jin/auth`'s `requireSessionOrAppToken` (or any
 * other auth primitive) directly. That's the whole point: which kernel
 * mechanism backs "who is calling this app" is a decision Ryan hasn't
 * finalized yet (see the DECISION card in FINDINGS.md), and this interface
 * exists so resolving that decision later is a one-file change, not a
 * route-by-route migration.
 *
 * Current implementation: `requireSessionOrAppToken` (`@ima-jin/auth`,
 * GitHub Packages) — mirrors coffee's #1974 reference adoption of the
 * #1069 Phase 1 scoped app-token, scoped to `aud = thisAppHost()`, with the
 * shared kernel session cookie as a transitional fallback.
 *
 * Candidate alternative implementation (not wired up, kept here as a
 * comment so the swap is obvious): `POST {kernel}/auth/api/apps/token`'s
 * proof-of-possession flow (`requireAppAuth` from `@ima-jin/auth`), the
 * `X-App-DID`/`X-App-Authorization` contract AGENTS.md §2 documents. That
 * flow needs no shared-cookie-domain assumption at all, at the cost of this
 * app needing to prove possession of its own registered keypair per call
 * site that mints a token. See FINDINGS.md for the tradeoffs.
 */
export interface AuthenticatedCaller {
  /** DID of the authenticated caller. */
  did: string;
  /** Capability scopes granted to this call (empty on the cookie fallback path). */
  scopes: string[];
  /** Which path authenticated this request — surfaced for logging/debugging only. */
  via: 'token' | 'cookie';
}

export type AuthenticateSuccess = { auth: AuthenticatedCaller };
export type AuthenticateFailure = { error: string; status: number };
export type AuthenticateResult = AuthenticateSuccess | AuthenticateFailure;

export interface AuthenticateOptions {
  requireScopes?: string[];
}

export async function authenticate(request: Request, options?: AuthenticateOptions): Promise<AuthenticateResult> {
  const result = await requireSessionOrAppToken(request, {
    aud: thisAppHost(),
    requireScopes: options?.requireScopes,
  });
  if ('error' in result) {
    return { error: result.error, status: result.status };
  }
  return { auth: result.auth };
}
