/**
 * This app's boot-time signing identity (refs imajin-ai#2411, ruled b by
 * Ryan 2026-09-27 — see the dykil#5 follow-up on imajin-ai#2413).
 *
 * `apps.provision` (kernel-side) mints this app's own Ed25519 keypair in the
 * vault and grants it to the app's own DID; this app never holds that key
 * in an env file. `@ima-jin/auth-client`'s `loadAppSigningKey()` fetches it
 * at boot instead: a one-time claim code redeems it on first boot, and a
 * locally persisted bootstrap keypair (never the signing key itself)
 * re-authenticates every later boot. See docs/REGISTRATION.md.
 *
 * Memory-only: the signing key returned here is cached in this module's own
 * process memory and never written to disk, another env var, or a log
 * line — only `loadAppSigningKey()`'s own narrow-purpose bootstrap keystore
 * file touches disk.
 *
 * Unclaimed boot mode (imajin-ai#2427): when neither a bootstrap keystore
 * nor `IMAJIN_APP_CLAIM_CODE` is present yet, `bootstrapSigningIdentity()`
 * returns without throwing instead of crashing boot — `middleware.ts`
 * serves a minimal "not claimed yet" page until an operator pastes a claim
 * code at `/claim` (`app/claim/page.tsx`, `app/api/claim/route.ts`, both of
 * which call `claimWithCode()` below). A *real* failure — a claim code that
 * IS provided but the kernel refuses, a network error, … — still throws.
 */
import {
  loadAppSigningKey,
  readKeystore,
  resolveKeystorePath,
  type AppSigningKey,
} from '@ima-jin/auth-client';

let signingIdentity: AppSigningKey | null = null;

/**
 * True once this app has a real, vault-minted signing identity in memory —
 * from this boot's `bootstrapSigningIdentity()` or a later `claimWithCode()`
 * hot-swap. False in unclaimed boot mode (imajin-ai#2427).
 */
export function isAppClaimed(): boolean {
  return signingIdentity !== null;
}

/**
 * True when `loadAppSigningKey()` has real material to exchange this boot —
 * an existing bootstrap keystore (every later boot) or a one-time claim
 * code (first boot only). Mirrors the SDK's own precondition check so this
 * module can decide to boot unclaimed *without* calling it at all.
 */
function hasClaimMaterial(): boolean {
  const keystorePath = resolveKeystorePath(process.env.IMAJIN_APP_KEYSTORE);
  return readKeystore(keystorePath) !== null || Boolean(process.env.IMAJIN_APP_CLAIM_CODE);
}

/**
 * Fetches and caches this app's own signing key. Call once at boot. Boots
 * unclaimed (see module docblock) instead of throwing when there is no
 * keystore and no claim code yet; still throws on any real failure.
 */
export async function bootstrapSigningIdentity(): Promise<void> {
  if (!hasClaimMaterial()) {
    return;
  }
  signingIdentity = await loadAppSigningKey();
}

/** Returns the cached signing key. Throws if called before `bootstrapSigningIdentity()` or `claimWithCode()` has succeeded. */
export function getSigningIdentity(): AppSigningKey {
  if (!signingIdentity) {
    throw new Error(
      'Signing identity not bootstrapped yet — call bootstrapSigningIdentity() first, or this app has not been claimed yet (see /claim).'
    );
  }
  return signingIdentity;
}

export interface ClaimWithCodeParams {
  /** The one-time claim code the operator pasted into `/claim`. */
  claimCode: string;
  /** Best-effort label (e.g. request origin) recorded on the kernel's /jin timeline only. */
  hostHint?: string;
}

/**
 * Redeems a one-time claim code submitted through the operator `/claim`
 * page (`app/api/claim/route.ts`) — the browser-paste path imajin-ai#2427
 * adds alongside the existing `IMAJIN_APP_CLAIM_CODE` env-var path. Hot-
 * swaps this process's in-memory signing identity immediately — no restart
 * required, though a restart also works (it just re-reads the now-present
 * keystore).
 */
export async function claimWithCode(params: ClaimWithCodeParams): Promise<AppSigningKey> {
  const identity = await loadAppSigningKey({ claimCode: params.claimCode, hostHint: params.hostHint });
  signingIdentity = identity;
  return identity;
}

/** Test-only: clears the in-memory signing identity between test cases. */
export function resetSigningIdentityForTests(): void {
  signingIdentity = null;
}
