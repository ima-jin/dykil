import { vi } from 'vitest';

/**
 * `@ima-jin/ui` pulls in a markdown editor and the whole kernel chrome; page
 * tests only need the parts this app touches (toasts, NavBar, footer), so they
 * are replaced with light stand-ins. `toast` is exported for assertions.
 */
export const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

export function resetUiMock(): void {
  for (const fn of Object.values(toast)) fn.mockReset();
}

vi.mock('@ima-jin/ui', () => ({
  useToast: () => ({ toast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="toast-provider">{children}</div>,
  NavBar: ({ currentService, servicePrefix, domain }: { currentService?: string; servicePrefix?: string; domain?: string }) => (
    <nav data-testid="navbar" data-service={currentService} data-prefix={servicePrefix} data-domain={domain} />
  ),
  ImajinFooter: () => <footer data-testid="imajin-footer" />,
}));
