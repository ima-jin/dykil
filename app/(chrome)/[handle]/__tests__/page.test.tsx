// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import { callLog, stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';

import HandlePage from '../page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const route = (extra: Partial<FetchRoute>): FetchRoute => ({ match: '/dykil/api/surveys/handle/alice', ...extra });
const mount = async (handle = 'alice') => render(await HandlePage({ params: Promise.resolve({ handle }) }));

describe('/[handle] — a handle’s public survey listing', () => {
  it('lists the published surveys, each linking to its respondent page', async () => {
    stubFetchRoutes([
      route({
        body: {
          surveys: [
            { id: 's1', title: 'Feedback', description: 'Tell us', createdAt: '2026-01-02T00:00:00.000Z' },
            { id: 's 2', title: 'Poll', description: null, createdAt: '2026-02-03T00:00:00.000Z' },
          ],
        },
      }),
    ]);
    await mount();

    expect(await screen.findByRole('heading', { name: '@alice' })).toBeInTheDocument();
    const first = screen.getByRole('link', { name: /Feedback/ });
    expect(first).toHaveAttribute('href', '/alice/s1');
    expect(within(first).getByText('Tell us')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Poll/ })).toHaveAttribute('href', '/alice/s%202');
  });

  it('says so when the handle has published nothing', async () => {
    stubFetchRoutes([route({ body: { surveys: [] } })]);
    await mount();
    expect(await screen.findByText('No published surveys')).toBeInTheDocument();
  });

  it('decodes the handle from the URL before asking for it', async () => {
    const mock = stubFetchRoutes([{ match: '/dykil/api/surveys/handle/a%20b', body: { surveys: [] } }]);
    await mount('a%20b');
    expect(await screen.findByRole('heading', { name: '@a b' })).toBeInTheDocument();
    expect(callLog(mock)[0][1]).toBe('/dykil/api/surveys/handle/a%20b');
  });

  it.each<[string, Partial<FetchRoute>, string]>([
    ['an unknown handle', { status: 404, body: { error: 'Profile not found' } }, 'Profile not found'],
    ['a signed-out visitor', { status: 401, body: { error: 'Not authenticated' } }, "Sign in to see @alice's surveys"],
    ['a failure', { status: 500, body: { error: 'Kernel down' } }, 'Could not load surveys'],
  ])('handles %s', async (_label, extra, title) => {
    stubFetchRoutes([route(extra)]);
    await mount();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('ignores a late answer after the page is gone', async () => {
    stubFetchRoutes([route({ body: { surveys: [] } })]);
    const { unmount } = await mount();
    unmount();
    expect(screen.queryByText('No published surveys')).not.toBeInTheDocument();
  });
});
