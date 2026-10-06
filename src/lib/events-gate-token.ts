import { randomUUID } from 'node:crypto';
import { signBootstrapPayload } from '@ima-jin/auth-client';
import { appDid, authServiceUrl, eventsGateAuthorizationId } from '@/lib/env';
import { getSigningIdentity, isAppClaimed } from '@/lib/auth/signing-identity';

/** The scope the events app's ticket-holder gate requires of its caller. */
export const EVENTS_GATE_SCOPE = 'events:read';

/** Refresh a cached token this long before the kernel says it expires. */
const EXPIRY_SKEW_MS = 30_000;

export class GateTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateTokenUnavailableError';
  }
}

export interface GateTokenProvider {
  /** True once everything needed to mint a token is configured. */
  isConfigured(): boolean;
  getToken(): Promise<string>;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Mints the scoped app token this app presents to the events app's
 * ticket-holder gate (`GET /api/events/{id}/access` requires `Authorization:
 * Bearer <app-token>` carrying `events:read`; session cookies are refused).
 *
 * This is the kernel's proof-of-possession flow, `POST {kernel}/auth/api/apps/token`
 * (AGENTS.md §2's `X-App-DID` / `X-App-Authorization` contract): the app signs
 * `${appDid}:${attestationId}:${nonce}:${timestamp}` with its OWN vault-held
 * key (never a respondent's) and presents the `app.authorized` attestation id
 * — `DYKIL_EVENTS_AUTHORIZATION_ID` — that grants it `events:read`. Tokens
 * live ~10 minutes, so one is cached in memory and refreshed shortly before
 * it expires.
 */
export class KernelGateTokenProvider implements GateTokenProvider {
  private cached: CachedToken | null = null;

  isConfigured(): boolean {
    return Boolean(eventsGateAuthorizationId()) && isAppClaimed();
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
      return this.cached.token;
    }
    const minted = await this.mint();
    this.cached = minted;
    return minted.token;
  }

  private async mint(): Promise<CachedToken> {
    const attestationId = eventsGateAuthorizationId();
    if (!attestationId || !isAppClaimed()) {
      throw new GateTokenUnavailableError('The events gate token cannot be minted: app is unclaimed or DYKIL_EVENTS_AUTHORIZATION_ID is unset');
    }
    const identity = getSigningIdentity();
    const did = appDid() ?? identity.appDid;
    const nonce = randomUUID().replaceAll('-', '');
    const timestamp = new Date().toISOString();
    const signature = signBootstrapPayload(`${did}:${attestationId}:${nonce}:${timestamp}`, identity.privateKey);

    const response = await fetch(`${authServiceUrl()}/api/apps/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appDid: did, attestationId, scope: EVENTS_GATE_SCOPE, nonce, timestamp, signature }),
      cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as { token?: string; expiresIn?: number; error?: string } | null;
    if (!response.ok || !body?.token) {
      throw new GateTokenUnavailableError(body?.error ?? `Kernel refused to mint the events gate token (${response.status})`);
    }
    return { token: body.token, expiresAtMs: Date.now() + (body.expiresIn ?? 0) * 1000 };
  }
}
