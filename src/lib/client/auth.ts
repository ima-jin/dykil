/** The kernel origin the "Sign in with Imajin" flow lives on (build-time, see .env.example). */
export function kernelOrigin(): string {
  return process.env.NEXT_PUBLIC_IMAJIN_AUTH_URL ?? '';
}

/**
 * The kernel's login page, returning to `returnTo` (an absolute URL) after
 * sign-in. `returnTo` is always this app's own location, never user input.
 */
export function signInUrl(returnTo: string): string {
  return `${kernelOrigin()}/auth/login?next=${encodeURIComponent(returnTo)}`;
}

/** Sign-in link that brings the visitor back to the page they are on. */
export function signInUrlForCurrentPage(): string {
  return signInUrl(globalThis.location.href);
}
