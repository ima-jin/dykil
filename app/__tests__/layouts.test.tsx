// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/ui-mock';

import RootLayout, { metadata, viewport } from '../layout';
import ChromeLayout from '../(chrome)/layout';
import BareLayout from '../(bare)/layout';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('root layout', () => {
  it('is the dark shell, with the shared toast host around every page', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>page</main>
      </RootLayout>,
    );
    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).toContain('data-testid="toast-provider"');
    expect(html).toContain('<main>page</main>');
  });

  it('carries the shared service metadata', () => {
    expect(String(metadata.title)).toContain('Dykil');
    expect(viewport).toBeDefined();
  });
});

describe('(chrome) layout', () => {
  it('shows the shared Imajin NavBar for Surveys, pointed at the kernel origin', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAJIN_AUTH_URL', 'https://dev-jin.imajin.ai');
    render(
      <ChromeLayout>
        <p>content</p>
      </ChromeLayout>,
    );
    const nav = screen.getByTestId('navbar');
    expect(nav).toHaveAttribute('data-service', 'Surveys');
    expect(nav).toHaveAttribute('data-prefix', 'https://dev-jin.imajin.ai');
    expect(nav).toHaveAttribute('data-domain', 'dev-jin.imajin.ai');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('(bare) layout', () => {
  it('adds nothing around an embed', () => {
    render(
      <BareLayout>
        <p>embed</p>
      </BareLayout>,
    );
    expect(screen.getByText('embed')).toBeInTheDocument();
    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
  });
});
