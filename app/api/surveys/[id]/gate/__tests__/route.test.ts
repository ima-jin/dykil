import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asCaller,
  authenticateMock,
  publishedSurveyDocFixture as doc,
  readOwnerSurveyAssetMock,
  readPublicSurveyAssetMock,
  resetSurveyRouteMocks,
  routeParams as params,
} from '@/test/helpers/survey-route-mocks';

const { hasAccessMock } = vi.hoisted(() => ({ hasAccessMock: vi.fn() }));

vi.mock('@/lib/ticket-gate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ticket-gate')>('@/lib/ticket-gate');
  return { ...actual, defaultTicketGate: () => ({ hasAccess: hasAccessMock }) };
});

import { KernelMediaError } from '@/lib/kernel/media';
import { TicketGateError, TicketGateNotConfiguredError } from '@/lib/ticket-gate';
import { GET, OPTIONS } from '../route';

const gated = { ...doc, settings: { eventId: 'event_1' } };
const request = () => new Request('https://dykil.imajin.ai/api/surveys/asset_1/gate');

describe('OPTIONS /api/surveys/:id/gate', () => {
  it('returns the shared CORS preflight response', async () => {
    expect((await OPTIONS(request() as never)).status).toBeLessThan(400);
  });
});

describe('GET /api/surveys/:id/gate', () => {
  beforeEach(() => {
    resetSurveyRouteMocks();
    hasAccessMock.mockReset();
    authenticateMock.mockResolvedValue(asCaller('did:imajin:respondent'));
    readPublicSurveyAssetMock.mockResolvedValue(doc);
  });

  it('requires dykil:read', async () => {
    authenticateMock.mockResolvedValue({ error: 'Not authenticated', status: 401 });
    const response = await GET(request() as never, params('asset_1'));
    expect(response.status).toBe(401);
    expect(authenticateMock).toHaveBeenCalledWith(expect.anything(), { requireScopes: ['dykil:read'] });
  });

  it('answers 404 for an unknown survey', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(null);
    readOwnerSurveyAssetMock.mockResolvedValue(null);
    expect((await GET(request() as never, params('asset_1'))).status).toBe(404);
  });

  it('lets anyone through an ungated survey without consulting the gate', async () => {
    const response = await GET(request() as never, params('asset_1'));
    expect(await response.json()).toEqual({ gated: false, allowed: true });
    expect(hasAccessMock).not.toHaveBeenCalled();
  });

  it.each([
    ['admits a ticket holder', true, { gated: true, allowed: true }],
    ['blocks a non-holder', false, { gated: true, allowed: false }],
  ])('%s', async (_label, hasAccess, expected) => {
    readPublicSurveyAssetMock.mockResolvedValue(gated);
    hasAccessMock.mockResolvedValue(hasAccess);

    const response = await GET(request() as never, params('asset_1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(hasAccessMock).toHaveBeenCalledWith({ eventId: 'event_1', did: 'did:imajin:respondent' });
  });

  it.each([
    ['an unconfigured gate answers 501', new TicketGateNotConfiguredError(), 501],
    ['an unreachable gate answers 502', new TicketGateError('down', 500), 502],
  ])('%s — never "allowed"', async (_label, failure, status) => {
    readPublicSurveyAssetMock.mockResolvedValue(gated);
    hasAccessMock.mockRejectedValue(failure);
    expect((await GET(request() as never, params('asset_1'))).status).toBe(status);
  });

  it('passes a kernel media failure through', async () => {
    readPublicSurveyAssetMock.mockRejectedValue(new KernelMediaError('down', 503, null));
    expect((await GET(request() as never, params('asset_1'))).status).toBe(503);
  });

  it('answers 500 for an unexpected failure', async () => {
    readPublicSurveyAssetMock.mockResolvedValue(gated);
    hasAccessMock.mockRejectedValue(new Error('boom'));
    expect((await GET(request() as never, params('asset_1'))).status).toBe(500);
  });
});
