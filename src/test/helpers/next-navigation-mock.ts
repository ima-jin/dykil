import { vi } from 'vitest';

/**
 * Shared `next/navigation` stand-in for component tests. A test sets the query
 * string with `setSearchParams('id=abc')` and asserts navigation on `routerPush`.
 */
export const routerPush = vi.fn();
let searchParams = new URLSearchParams();

export function setSearchParams(query: string): void {
  searchParams = new URLSearchParams(query);
}

export function resetNavigationMock(): void {
  routerPush.mockReset();
  searchParams = new URLSearchParams();
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => searchParams,
}));
