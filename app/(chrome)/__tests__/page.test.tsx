// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/ui-mock';
import { stubFetchRoutes } from '@/test/helpers/fetch-mock';

import HomePage from '../page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/ (landing)', () => {
  it('explains what dykil is, whoever is looking', async () => {
    stubFetchRoutes([{ match: '/dykil/api/session', status: 401, body: {} }]);
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'dykil' })).toBeInTheDocument();
    expect(screen.getByText(/Sovereign surveys and polls/)).toBeInTheDocument();
    for (const feature of ['Powerful form builder', 'Signed responses', 'Built-in analytics', 'Event integration']) {
      expect(screen.getByRole('heading', { name: feature })).toBeInTheDocument();
    }
    expect(screen.getByTestId('imajin-footer')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Sign In to Get Started' });
  });

  it('sends a signed-out visitor to sign in, landing on the dashboard afterwards', async () => {
    vi.stubEnv('NEXT_PUBLIC_IMAJIN_AUTH_URL', 'https://dev-jin.imajin.ai');
    stubFetchRoutes([{ match: '/dykil/api/session', status: 401, body: {} }]);
    render(<HomePage />);

    const link = await screen.findByRole('link', { name: 'Sign In to Get Started' });
    expect(link).toHaveAttribute(
      'href',
      `https://dev-jin.imajin.ai/auth/login?next=${encodeURIComponent(`${globalThis.location.origin}/dykil/dashboard`)}`,
    );
    expect(screen.queryByRole('link', { name: 'Create a Survey' })).not.toBeInTheDocument();
  });

  it('takes a signed-in user to their surveys and to create one', async () => {
    stubFetchRoutes([{ match: '/dykil/api/session', body: { did: 'did:imajin:me' } }]);
    render(<HomePage />);

    expect(await screen.findByRole('link', { name: 'My Surveys →' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Create a Survey' })).toHaveAttribute('href', '/create');
    expect(screen.queryByRole('link', { name: 'Sign In to Get Started' })).not.toBeInTheDocument();
  });

  it.each([
    ['the session call fails', { fail: true }],
    ['the session has no DID', { body: {} }],
  ])('treats a visitor as signed out when %s', async (_label, route) => {
    stubFetchRoutes([{ match: '/dykil/api/session', ...route }]);
    render(<HomePage />);
    expect(await screen.findByRole('link', { name: 'Sign In to Get Started' })).toBeInTheDocument();
  });

  it('shows no call to action while the session is still loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const { container } = render(<HomePage />);
    expect(container.querySelector('a[href*="login"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'My Surveys →' })).not.toBeInTheDocument();
  });
});
