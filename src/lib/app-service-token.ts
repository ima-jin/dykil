import { EXPIRY_SKEW_MS, mintAppToken, type MintedAppToken } from '@/lib/app-token';
import { isAppClaimed } from '@/lib/auth/signing-identity';

export class AppServiceTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppServiceTokenUnavailableError';
  }
}

let cached: MintedAppToken | null = null;

/**
 * This app's OWN service token — `POST {kernel}/auth/api/apps/token/service`,
 * proof of possession of the app's vault-held signing key (see `mintAppToken`),
 * no user delegation: the token's subject is the app DID. Used by
 * `scripts/import-legacy.ts`, which runs outside any request context and so has
 * no caller credentials to forward, for its media asset writes and its
 * attestation writes. Cached in memory until shortly before it expires.
 *
 * Fails loudly (never degrades to an unauthenticated call) when the app is not
 * claimed, or the kernel refuses to mint.
 */
export async function getAppServiceToken(): Promise<string> {
  if (cached && cached.expiresAtMs - EXPIRY_SKEW_MS > Date.now()) {
    return cached.token;
  }
  if (!isAppClaimed()) {
    throw new AppServiceTokenUnavailableError(
      'The app service token cannot be minted: this app has not been claimed (no signing key). ' +
        'Provide IMAJIN_APP_CLAIM_CODE or an existing keystore — see docs/REGISTRATION.md.',
    );
  }
  cached = await mintAppToken({
    endpoint: 'apps/token/service',
    label: 'app service token',
    fail: (message) => new AppServiceTokenUnavailableError(message),
  });
  return cached.token;
}

/** `Authorization: Bearer <app service token>`, ready to spread into a request's headers. */
export async function appServiceAuthHeaders(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await getAppServiceToken()}` };
}

/** Test-only: drops the cached token between test cases. */
export function resetAppServiceTokenForTests(): void {
  cached = null;
}
