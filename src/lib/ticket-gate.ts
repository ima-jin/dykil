import { eventsServiceUrl } from '@/lib/env';
import { KernelGateTokenProvider, type GateTokenProvider } from '@/lib/events-gate-token';

/**
 * The ticket-holder check is a composable gate: the events app answers a
 * boolean, and this app never reads ticket data (Ryan's ruling, 2026-09-22).
 * The `responses/by-ticket/[ticketId]` cross-schema read the original
 * apps/dykil had is replaced by this gate — never by an API that returns
 * ticket rows.
 *
 * The gate is the events app's `GET /api/events/{id}/access?did=<did>`
 * (imajin-ai#2395), which answers exactly `{ "hasAccess": boolean }` — never a
 * ticket id, type, price or organizer. It requires a scoped app token with
 * `events:read` (see src/lib/events-gate-token.ts).
 */
export interface TicketGate {
  /** True iff `did` holds a (sold or used) ticket for `eventId`. */
  hasAccess(params: { eventId: string; did: string }): Promise<boolean>;
}

export class TicketGateNotConfiguredError extends Error {
  constructor() {
    super(
      'The ticket gate is not configured — set EVENTS_SERVICE_URL and DYKIL_EVENTS_AUTHORIZATION_ID ' +
        '(an app.authorized attestation granting events:read) and claim this app. ' +
        'Ticket-scoped surveys cannot be gated until then.',
    );
    this.name = 'TicketGateNotConfiguredError';
  }
}

/** The events app answered the gate with something other than a boolean: 401/403 (token), 404 (unknown event), 5xx. */
export class TicketGateError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TicketGateError';
    this.status = status;
  }
}

/**
 * Asks the events app's boolean gate. Fails closed and loudly: an unreachable
 * or misconfigured gate throws (surfaced as a 5xx), it never degrades to
 * "no ticket" or — worse — to "has a ticket", and never falls back to reading
 * ticket rows.
 */
export class HttpTicketGate implements TicketGate {
  constructor(
    private readonly eventsUrl: string | undefined,
    private readonly tokens: GateTokenProvider,
  ) {}

  async hasAccess(params: { eventId: string; did: string }): Promise<boolean> {
    if (!this.eventsUrl || !this.tokens.isConfigured()) {
      throw new TicketGateNotConfiguredError();
    }
    const token = await this.tokens.getToken();
    // A trailing slash keeps the events service's own path prefix (e.g. `/events`) when resolving.
    const base = this.eventsUrl.endsWith('/') ? this.eventsUrl : `${this.eventsUrl}/`;
    const url = new URL(`api/events/${encodeURIComponent(params.eventId)}/access`, base);
    url.searchParams.set('did', params.did);

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new TicketGateError(body?.error ?? `Ticket gate answered ${response.status}`, response.status);
    }
    const body = (await response.json()) as { hasAccess?: boolean };
    return body.hasAccess === true;
  }
}

/** One provider per process so the minted token's cache is shared across requests. */
const defaultGateTokens: GateTokenProvider = new KernelGateTokenProvider();

export function defaultTicketGate(): TicketGate {
  return new HttpTicketGate(eventsServiceUrl(), defaultGateTokens);
}
