// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import { stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));
vi.mock('@/lib/client/download', () => ({ downloadTextFile: downloadMock }));

import ResultsPage from '../page';

beforeEach(() => downloadMock.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SURVEY = {
  id: 's1',
  title: 'Event: feedback',
  status: 'published',
  description: null,
  fields: {
    elements: [
      { type: 'radiogroup', name: 'color', title: 'Colour' },
      { type: 'rating', name: 'stars', title: 'Stars', rateMax: 5 },
      { type: 'boolean', name: 'ok', title: 'Fine?' },
      { type: 'comment', name: 'note', title: 'Notes' },
      { type: 'checkbox', name: 'langs', title: 'Languages' },
    ],
  },
};
const row = (id: string, answers: Record<string, unknown>, provenance = 'respondent-signed') => ({
  id,
  issuerDid: `did:imajin:${id}`,
  issuedAt: '2026-01-02T03:04:05.000Z',
  payload: { answers, provenance },
});
const survey: FetchRoute = { match: '/dykil/api/surveys/s1', body: SURVEY };
const responses = (extra: Partial<FetchRoute>): FetchRoute => ({ match: '/dykil/api/surveys/s1/responses', ...extra });
const mount = async () => render(await ResultsPage({ params: Promise.resolve({ id: 's1' }) }));

describe('/survey/[id]/results', () => {
  const rows = [
    row('r1', { color: 'red', stars: 4, ok: true, note: 'great', langs: ['ts', 'go'] }),
    row('r2', { color: 'red', stars: 2, ok: false, note: 'meh', langs: ['ts'] }, 'node-witnessed-legacy-import'),
    row('r3', { color: 'blue' }),
  ];

  it('aggregates every question from the response attestations', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: rows, total: 3 } })]);
    await mount();

    expect(await screen.findByRole('heading', { name: 'Event: feedback' })).toBeInTheDocument();
    expect(screen.getAllByText('3 responses').length).toBeGreaterThan(0);

    const colour = screen.getByRole('heading', { name: 'Colour' }).closest('section') as HTMLElement;
    expect(within(colour).getByText('2 (66.7%)')).toBeInTheDocument();
    expect(within(colour).getByText('1 (33.3%)')).toBeInTheDocument();

    const stars = screen.getByRole('heading', { name: 'Stars' }).closest('section') as HTMLElement;
    expect(within(stars).getByText('3.00 / 5')).toBeInTheDocument();

    const fine = screen.getByRole('heading', { name: 'Fine?' }).closest('section') as HTMLElement;
    expect(within(fine).getByText('Yes')).toBeInTheDocument();
    expect(within(fine).getByText('No')).toBeInTheDocument();

    const notes = screen.getByRole('heading', { name: 'Notes' }).closest('section') as HTMLElement;
    expect(within(notes).getByText('great')).toBeInTheDocument();
    expect(within(notes).getByText('meh')).toBeInTheDocument();
  });

  it('lists each response with its answers, newest numbering first, flagging legacy imports', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: rows } })]);
    await mount();
    await screen.findByRole('heading', { name: 'Individual Responses' });

    const summaries = screen.getAllByText(/^Response #/);
    expect(summaries.map((node) => node.textContent?.slice(0, 11))).toEqual(['Response #3', 'Response #2', 'Response #1']);
    expect(screen.getByText('legacy import')).toBeInTheDocument();
    const sparse = summaries[2].closest('details') as HTMLElement;
    expect(within(sparse).getAllByText('No answer').length).toBeGreaterThan(0);
    const second = summaries[1].closest('details') as HTMLElement;
    expect(within(second).getByText('ts')).toBeInTheDocument();
  });

  it('says a survey with no responses has none, and disables the export', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: [] } })]);
    await mount();
    expect(await screen.findByText('No responses yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('exports a CSV of the responses', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: [rows[0]] } })]);
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));

    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [filename, csv, mime] = downloadMock.mock.calls[0];
    expect(filename).toBe('Event__feedback_results.csv');
    expect(mime).toBe('text/csv');
    expect(String(csv).split('\n')[0]).toBe('"Response ID","Submitted At","Colour","Stars","Fine?","Notes","Languages"');
    expect(String(csv).split('\n')[1]).toContain('"r1"');
    expect(String(csv)).toContain('"ts; go"');
  });

  it('links back to the dashboard', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: [] } })]);
    await mount();
    expect(await screen.findByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it.each<[string, FetchRoute[], string]>([
    ['signed out', [survey, responses({ status: 401, body: {} })], 'Sign in to see results'],
    ['someone else’s survey', [survey, responses({ status: 403, body: {} })], 'Not your survey'],
    ['an unknown survey', [{ match: '/dykil/api/surveys/s1', status: 404, body: {} }, responses({ status: 404, body: {} })], 'Survey not found'],
    ['a failure', [survey, responses({ status: 500, body: { error: 'Kernel down' } })], 'Could not load results'],
  ])('explains %s', async (_label, routes, title) => {
    stubFetchRoutes(routes);
    await mount();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('ignores a late answer after the page is gone', async () => {
    stubFetchRoutes([survey, responses({ body: { responses: [] } })]);
    const { unmount } = await mount();
    unmount();
    expect(screen.queryByText('No responses yet')).not.toBeInTheDocument();
  });
});
