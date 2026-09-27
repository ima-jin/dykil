import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultTicketGate, HttpTicketGate, TicketGateNotConfiguredError } from '../ticket-gate';

describe('HttpTicketGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws TicketGateNotConfiguredError when no gate URL is configured (FINDINGS.md gap #2395)', async () => {
    const gate = new HttpTicketGate(undefined);
    await expect(gate.hasAccess({ eventId: 'event_1', did: 'did:imajin:respondent' })).rejects.toBeInstanceOf(
      TicketGateNotConfiguredError,
    );
  });

  it('calls the configured gate URL with eventId + did and returns its boolean, never raw ticket rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasAccess: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const gate = new HttpTicketGate('https://events.example/api/ticket-gate');
    const result = await gate.hasAccess({ eventId: 'event_1', did: 'did:imajin:respondent' });

    expect(result).toBe(true);
    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.origin + url.pathname).toBe('https://events.example/api/ticket-gate');
    expect(url.searchParams.get('eventId')).toBe('event_1');
    expect(url.searchParams.get('did')).toBe('did:imajin:respondent');
  });

  it('treats a non-ok gate response as no access, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const gate = new HttpTicketGate('https://events.example/api/ticket-gate');
    expect(await gate.hasAccess({ eventId: 'event_1', did: 'did:imajin:respondent' })).toBe(false);
  });
});

describe('defaultTicketGate', () => {
  it('reads EVENTS_TICKET_GATE_URL from the environment', () => {
    const original = process.env.EVENTS_TICKET_GATE_URL;
    process.env.EVENTS_TICKET_GATE_URL = 'https://events.example/gate';
    try {
      expect(defaultTicketGate()).toBeInstanceOf(HttpTicketGate);
    } finally {
      if (original === undefined) delete process.env.EVENTS_TICKET_GATE_URL;
      else process.env.EVENTS_TICKET_GATE_URL = original;
    }
  });
});
