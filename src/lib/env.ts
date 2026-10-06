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

/**
 * Base URL of the events service, e.g. https://dev-jin.imajin.ai/events. Optional:
 * only ticket-gated surveys (`settings.eventId`) need it, and they answer 501
 * until it is configured.
 */
export function eventsServiceUrl(): string | undefined {
  return process.env.EVENTS_SERVICE_URL || undefined;
}

/**
 * The id of the `app.authorized` attestation that grants this app the
 * `events:read` scope — what the ticket gate's proof-of-possession token mint
 * (`POST {kernel}/auth/api/apps/token`) is bound to. Optional, same as above.
 */
export function eventsGateAuthorizationId(): string | undefined {
  return process.env.DYKIL_EVENTS_AUTHORIZATION_ID || undefined;
}

export const DYKIL_SURVEY_CONTEXT_TYPE = 'dykil.survey';
/** Upload context a survey document is stored under — `GET /media/api/assets?context_app=…&context_feature=…`. */
export const DYKIL_MEDIA_CONTEXT_APP = 'dykil';
export const DYKIL_MEDIA_CONTEXT_FEATURE = 'survey';
