import { eventsGateAuthorizationId } from '@/lib/env';
import { isAppClaimed } from '@/lib/auth/signing-identity';
import { EXPIRY_SKEW_MS, mintAppToken, type MintedAppToken } from '@/lib/app-token';

/** The scope the events app's ticket-holder gate requires of its caller. */
export const EVENTS_GATE_SCOPE = 'events:read';

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
  private cached: MintedAppToken | null = null;

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

  private async mint(): Promise<MintedAppToken> {
    const attestationId = eventsGateAuthorizationId();
    if (!attestationId || !isAppClaimed()) {
      throw new GateTokenUnavailableError('The events gate token cannot be minted: app is unclaimed or DYKIL_EVENTS_AUTHORIZATION_ID is unset');
    }
    return mintAppToken({
      endpoint: 'apps/token',
      attestationId,
      scope: EVENTS_GATE_SCOPE,
      label: 'events gate token',
      fail: (message) => new GateTokenUnavailableError(message),
    });
  }
}
