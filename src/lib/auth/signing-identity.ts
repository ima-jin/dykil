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
 */
import { loadAppSigningKey, type AppSigningKey } from '@ima-jin/auth-client';

let signingIdentity: AppSigningKey | null = null;

/** Fetches and caches this app's own signing key. Call once at boot; throws on any failure. */
export async function bootstrapSigningIdentity(): Promise<void> {
  signingIdentity = await loadAppSigningKey();
}

/** Returns the cached signing key. Throws if called before `bootstrapSigningIdentity()` has succeeded. */
export function getSigningIdentity(): AppSigningKey {
  if (!signingIdentity) {
    throw new Error('Signing identity not bootstrapped yet — call bootstrapSigningIdentity() first.');
  }
  return signingIdentity;
}
