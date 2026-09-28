/**
 * Central env-var accessors. `.env.example` is the contract (AGENTS.md §5) —
 * no hard-coded kernel URLs anywhere else in this app.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — see .env.example.`);
  }
  return value;
}

/** Base URL of the kernel's auth service, e.g. https://dev-jin.imajin.ai/auth. */
export function authServiceUrl(): string {
  return required('AUTH_SERVICE_URL');
}

/** Base URL of the kernel's media service, e.g. https://dev-jin.imajin.ai/media. */
export function mediaServiceUrl(): string {
  return required('MEDIA_SERVICE_URL');
}

/**
 * This app's own registered DID (see docs/REGISTRATION.md). Only required
 * once a bootstrap keystore already exists (`loadAppSigningKey()`'s first
 * boot returns it directly) — see `src/lib/auth/signing-identity.ts`.
 */
export function appDid(): string | undefined {
  return process.env.IMAJIN_APP_DID;
}

export function responseAttestationType(): string {
  return process.env.DYKIL_RESPONSE_ATTESTATION_TYPE ?? 'dykil/survey-response';
}

export function legacyImportAttestationType(): string {
  return process.env.DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE ?? 'dykil/survey-response-legacy-import';
}

/** This app's own host, used as the `aud` for scoped app-token verification. */
export function thisAppHost(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return 'dykil.imajin.ai';
  try {
    return new URL(base).host;
  } catch {
    return 'dykil.imajin.ai';
  }
}

export const DYKIL_SURVEY_CONTEXT_TYPE = 'dykil.survey';
