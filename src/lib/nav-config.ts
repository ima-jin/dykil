/**
 * Where the shared `@ima-jin/ui` NavBar finds the other Imajin services. The
 * kernel serves them path-based under one origin (`<origin>/auth`,
 * `<origin>/profile`, …), which the NavBar derives from a `servicePrefix` that
 * contains a dot. `NEXT_PUBLIC_IMAJIN_AUTH_URL` is that kernel origin and is
 * already part of this app's env contract, so nothing new is configured.
 */
export interface NavConfig {
  servicePrefix: string;
  domain: string;
}

const FALLBACK: NavConfig = { servicePrefix: 'https://', domain: 'imajin.ai' };

export function navConfig(kernelOrigin: string | undefined = process.env.NEXT_PUBLIC_IMAJIN_AUTH_URL): NavConfig {
  if (!kernelOrigin) return FALLBACK;
  try {
    const url = new URL(kernelOrigin);
    return { servicePrefix: url.origin, domain: url.host };
  } catch {
    return FALLBACK;
  }
}
