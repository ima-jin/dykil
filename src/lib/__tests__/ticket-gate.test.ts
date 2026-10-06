import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GateTokenProvider } from '../events-gate-token';
import { defaultTicketGate, HttpTicketGate, TicketGateError, TicketGateNotConfiguredError } from '../ticket-gate';

function tokens(overrides: Partial<GateTokenProvider> = {}): GateTokenProvider {
  return { isConfigured: () => true, getToken: async () => 'gate-token', ...overrides };
}

describe('HttpTicketGate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws TicketGateNotConfiguredError when no events service URL is configured', async () => {
    const gate = new HttpTicketGate(undefined, tokens());
    await expect(gate.hasAccess({ eventId: 'event_1', did: 'did:imajin:respondent' })).rejects.toBeInstanceOf(
      TicketGateNotConfiguredError,
    );
  });

  it('throws TicketGateNotConfiguredError when the token provider is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = new HttpTicketGate('https://events.example/events', tokens({ isConfigured: () => false }));
    await expect(gate.hasAccess({ eventId: 'event_1', did: 'did:imajin:respondent' })).rejects.toBeInstanceOf(
      TicketGateNotConfiguredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks GET {events}/api/events/{id}/access?did= with the app token and returns its boolean, never ticket rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasAccess: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const gate = new HttpTicketGate('https://events.example/events', tokens());
    const result = await gate.hasAccess({ eventId: 'event 1', did: 'did:imajin:respondent' });

    expect(result).toBe(true);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.origin + url.pathname).toBe('https://events.example/events/api/events/event%201/access');
    expect(url.searchParams.get('did')).toBe('did:imajin:respondent');
    expect(init.headers).toEqual({ Authorization: 'Bearer gate-token' });
  });

  it('keeps the events path prefix whether or not the configured URL ends in a slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasAccess: false }) });
    vi.stubGlobal('fetch', fetchMock);

    const gate = new HttpTicketGate('https://events.example/events/', tokens());
    expect(await gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' })).toBe(false);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/events/api/events/e/access');
  });

  it('only a literal true counts as access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hasAccess: 'yes' }) }));
    const gate = new HttpTicketGate('https://events.example', tokens());
    expect(await gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' })).toBe(false);
  });

  it.each([
    [401, 'Authorization: Bearer <app-token> required'],
    [403, 'Missing scope'],
    [404, 'Event not found'],
    [500, 'Access check failed'],
  ])('fails closed with a TicketGateError on a %i, never degrading to "no ticket"', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: message }) }));
    const gate = new HttpTicketGate('https://events.example', tokens());
    const failure = await gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TicketGateError);
    expect(failure).toMatchObject({ status, message });
  });

  it('uses a generic message when the gate error carries no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error('no json')) }));
    const gate = new HttpTicketGate('https://events.example', tokens());
    await expect(gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' })).rejects.toMatchObject({
      status: 502,
      message: 'Ticket gate answered 502',
    });
  });

  it('propagates a token-mint failure instead of calling the gate unauthenticated', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = new HttpTicketGate('https://events.example', tokens({ getToken: async () => Promise.reject(new Error('mint failed')) }));
    await expect(gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' })).rejects.toThrow('mint failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('defaultTicketGate', () => {
  it('reads EVENTS_SERVICE_URL from the environment, and is unconfigured without the app credentials', async () => {
    const original = process.env.EVENTS_SERVICE_URL;
    process.env.EVENTS_SERVICE_URL = 'https://events.example/events';
    try {
      const gate = defaultTicketGate();
      expect(gate).toBeInstanceOf(HttpTicketGate);
      // No claimed app identity / authorization id in the test environment.
      await expect(gate.hasAccess({ eventId: 'e', did: 'did:imajin:x' })).rejects.toBeInstanceOf(TicketGateNotConfiguredError);
    } finally {
      if (original === undefined) delete process.env.EVENTS_SERVICE_URL;
      else process.env.EVENTS_SERVICE_URL = original;
    }
  });
});
