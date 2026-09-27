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

/** This app's own registered DID (see docs/REGISTRATION.md). */
export function appDid(): string | undefined {
  return process.env.IMAJIN_APP_DID;
}

/** This app's own Ed25519 private key, used only for self-signed legacy-import attestations. */
export function appPrivateKey(): string | undefined {
  return process.env.DYKIL_APP_PRIVATE_KEY;
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
