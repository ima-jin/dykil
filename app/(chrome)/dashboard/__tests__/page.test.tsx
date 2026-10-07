// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import { resetUiMock, toast } from '@/test/helpers/ui-mock';
import { callLog, stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';

import DashboardPage from '../page';

const survey = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Survey ${id}`,
  description: `About ${id}`,
  status: 'published',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...extra,
});
const mine = (surveys: unknown[]): FetchRoute => ({ match: '/dykil/api/surveys/mine', body: { surveys } });

beforeEach(() => resetUiMock());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/dashboard', () => {
  it('lists the owner’s surveys with status, response counts and actions', async () => {
    stubFetchRoutes([
      mine([survey('a'), survey('b', { status: 'draft', description: null })]),
      { match: '/dykil/api/surveys/a/responses', body: { responses: [], total: 1 } },
      { match: '/dykil/api/surveys/b/responses', body: { responses: [], total: 4 } },
    ]);
    render(<DashboardPage />);

    const first = (await screen.findByText('Survey a')).closest('li') as HTMLElement;
    expect(within(first).getByText('published')).toBeInTheDocument();
    expect(within(first).getByText('1 response')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/create?id=a');
    expect(within(first).getByRole('link', { name: 'View Results' })).toHaveAttribute('href', '/survey/a/results');
    expect(within(first).getByRole('button', { name: 'Copy Link' })).toBeInTheDocument();

    const second = screen.getByText('Survey b').closest('li') as HTMLElement;
    expect(within(second).getByText('draft')).toBeInTheDocument();
    expect(within(second).getByText('4 responses')).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: 'Copy Link' })).not.toBeInTheDocument();
  });

  it('shows 0 responses when a count could not be read', async () => {
    stubFetchRoutes([mine([survey('a')]), { match: '/dykil/api/surveys/a/responses', status: 500, body: {} }]);
    render(<DashboardPage />);
    expect(await screen.findByText('0 responses')).toBeInTheDocument();
  });

  it('offers to create the first survey when there are none', async () => {
    stubFetchRoutes([mine([])]);
    render(<DashboardPage />);
    expect(await screen.findByText('No surveys yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create Your First Survey' })).toHaveAttribute('href', '/create');
  });

  it('copies the shareable respondent link', async () => {
    stubFetchRoutes([mine([survey('a')]), { match: '/dykil/api/surveys/a/responses', body: { total: 0 } }]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DashboardPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith(`${globalThis.location.origin}/dykil/survey/a`);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Survey link copied!'));
  });

  describe('delete', () => {
    const routes = (del: FetchRoute): FetchRoute[] => [
      mine([survey('a')]),
      { match: '/dykil/api/surveys/a/responses', body: { total: 0 } },
      del,
    ];

    it('does nothing when the owner declines the confirmation', async () => {
      const mock = stubFetchRoutes(routes({ method: 'DELETE', match: '/dykil/api/surveys/a', body: {} }));
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      render(<DashboardPage />);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      expect(callLog(mock).some(([method]) => method === 'DELETE')).toBe(false);
    });

    it('deletes and refreshes the list when confirmed', async () => {
      const mock = stubFetchRoutes(routes({ method: 'DELETE', match: '/dykil/api/surveys/a', body: { deleted: true } }));
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      render(<DashboardPage />);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(callLog(mock).filter(([method, path]) => method === 'GET' && path.endsWith('/surveys/mine'))).toHaveLength(2));
      expect(callLog(mock).some(([method, path]) => method === 'DELETE' && path === '/dykil/api/surveys/a')).toBe(true);
    });

    it('reports a failed delete and keeps the survey', async () => {
      stubFetchRoutes(routes({ method: 'DELETE', match: '/dykil/api/surveys/a', status: 403, body: { error: 'Not authorized to delete this survey' } }));
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      render(<DashboardPage />);

      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not authorized to delete this survey'));
      expect(screen.getByText('Survey a')).toBeInTheDocument();
    });
  });

  it('asks a signed-out visitor to sign in, returning them here', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/mine', status: 401, body: { error: 'Not authenticated' } }]);
    render(<DashboardPage />);
    const link = await screen.findByRole('link', { name: 'Sign in with Imajin' });
    expect(link.getAttribute('href')).toContain('/auth/login?next=');
    expect(screen.getByText('Sign in to see your surveys')).toBeInTheDocument();
  });

  it('shows the error when the list cannot be loaded', async () => {
    stubFetchRoutes([{ match: '/dykil/api/surveys/mine', status: 500, body: { error: 'Kernel down' } }]);
    render(<DashboardPage />);
    expect(await screen.findByText('Could not load your surveys')).toBeInTheDocument();
    expect(screen.getByText('Kernel down')).toBeInTheDocument();
  });
});
