/**
 * The ticket-holder check is a composable gate: the events app answers a
 * boolean, and this app never reads ticket data (Ryan's ruling, 2026-09-22).
 * The `responses/by-ticket/[ticketId]` cross-schema read the original
 * apps/dykil had is replaced by this gate — never by an API that returns
 * ticket rows.
 *
 * As of this writing the events app exposes no such endpoint: its only
 * ticket-access check, `GET /api/events/{id}/my-ticket`, is scoped to the
 * events app's OWN session cookie for the CALLER's own identity — it has no
 * `{did, eventId}` parameter pair a third-party app could call with a scoped
 * app-token, and it isn't part of any published api-spec. See FINDINGS.md
 * gap #2395 (filed). This interface is stubbed behind
 * `EVENTS_TICKET_GATE_URL` so the gap is explicit rather than silently
 * worked around with a `by-ticket` read.
 */
export interface TicketGate {
  /** True iff `did` holds a (non-refunded) ticket for `eventId`. */
  hasAccess(params: { eventId: string; did: string }): Promise<boolean>;
}

export class TicketGateNotConfiguredError extends Error {
  constructor() {
    super(
      'EVENTS_TICKET_GATE_URL is not set — the events app does not yet expose a public, ' +
        'app-token-gated boolean ticket-holder endpoint (see FINDINGS.md gap #2395). ' +
        'Ticket-scoped surveys cannot be gated until it does.',
    );
    this.name = 'TicketGateNotConfiguredError';
  }
}

/**
 * Calls a future `{eventId, did} -> { hasAccess: boolean }` endpoint on the
 * events app once one exists. Never falls back to reading ticket rows.
 */
export class HttpTicketGate implements TicketGate {
  constructor(private readonly gateUrl: string | undefined) {}

  async hasAccess(params: { eventId: string; did: string }): Promise<boolean> {
    if (!this.gateUrl) {
      throw new TicketGateNotConfiguredError();
    }
    const url = new URL(this.gateUrl);
    url.searchParams.set('eventId', params.eventId);
    url.searchParams.set('did', params.did);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return false;
    const body = (await response.json()) as { hasAccess?: boolean };
    return body.hasAccess === true;
  }
}

export function defaultTicketGate(): TicketGate {
  return new HttpTicketGate(process.env.EVENTS_TICKET_GATE_URL);
}
