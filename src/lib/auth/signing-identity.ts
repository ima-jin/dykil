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
 * Memory-only: the signing key returned here is cached in process memory
 * (on `globalThis`, see `SIGNING_IDENTITY_KEY` below) and never written to disk, another env var, or a log
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
import { rmSync } from 'node:fs';
import {
  loadAppSigningKey,
  readKeystore,
  resolveKeystorePath,
  type AppSigningKey,
} from '@ima-jin/auth-client';

/**
 * The identity lives on `globalThis` under a `Symbol.for(...)` key — NOT in a
 * module-level variable. Next.js bundles `instrumentation.ts` (which calls
 * `bootstrapSigningIdentity()` at boot) separately from the app-route
 * bundles, so each gets its own copy of this module; a plain module
 * variable set at boot would never be seen by routes after a restart.
 * `Symbol.for` returns the same symbol across every bundle copy, so all of
 * them share one slot. The symbol-keyed slot is not enumerable by string
 * key and is never serialised.
 */
const SIGNING_IDENTITY_KEY = Symbol.for('imajin.app.signingIdentity');

interface SigningIdentityStore {
  [SIGNING_IDENTITY_KEY]?: AppSigningKey | null;
}

function readSigningIdentity(): AppSigningKey | null {
  return (globalThis as SigningIdentityStore)[SIGNING_IDENTITY_KEY] ?? null;
}

function writeSigningIdentity(identity: AppSigningKey | null): void {
  (globalThis as SigningIdentityStore)[SIGNING_IDENTITY_KEY] = identity;
}

/**
 * True once this app has a real, vault-minted signing identity in memory —
 * from this boot's `bootstrapSigningIdentity()` or a later `claimWithCode()`
 * hot-swap. False in unclaimed boot mode (imajin-ai#2427).
 */
export function isAppClaimed(): boolean {
  return readSigningIdentity() !== null;
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
  writeSigningIdentity(await loadAppSigningKey());
}

/** Returns the cached signing key. Throws if called before `bootstrapSigningIdentity()` or `claimWithCode()` has succeeded. */
export function getSigningIdentity(): AppSigningKey {
  const signingIdentity = readSigningIdentity();
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
 * Thrown by `claimWithCode()` when the kernel redeemed the code for a
 * DIFFERENT app than this one (`IMAJIN_APP_DID`) — e.g. an operator pasted
 * a code copied from a sibling app's `/jin` card. Never carries key
 * material: both fields are public DIDs, safe to log or return to a caller.
 */
export class AppDidMismatchError extends Error {
  constructor(
    public readonly expectedAppDid: string,
    public readonly claimedAppDid: string
  ) {
    super(
      `claimWithCode: kernel redeemed this code for '${claimedAppDid}', but this app is '${expectedAppDid}' — refusing to adopt a foreign identity`
    );
    this.name = 'AppDidMismatchError';
  }
}

/**
 * Redeems a one-time claim code submitted through the operator `/claim`
 * page (`app/api/claim/route.ts`) — the browser-paste path imajin-ai#2427
 * adds alongside the existing `IMAJIN_APP_CLAIM_CODE` env-var path. Hot-
 * swaps this process's in-memory signing identity immediately — no restart
 * required, though a restart also works (it just re-reads the now-present
 * keystore).
 *
 * Verifies the kernel's returned `appDid` against this app's own
 * `IMAJIN_APP_DID` (when set) before adopting it — a claim code pasted from
 * a DIFFERENT app's `/jin` card would otherwise hot-swap this process to a
 * foreign identity that the next restart's bootstrap-key fetch can never
 * re-authenticate as. `loadAppSigningKey()` itself already persisted the
 * bootstrap keystore as a side effect of the successful kernel exchange by
 * the time we see the mismatch here (see its own docblock: written right
 * after a successful redemption, before returning) — that write is undone
 * below so a foreign-app claim never leaves a keystore behind, and the
 * in-memory identity is never swapped.
 */
export async function claimWithCode(params: ClaimWithCodeParams): Promise<AppSigningKey> {
  const identity = await loadAppSigningKey({ claimCode: params.claimCode, hostHint: params.hostHint });

  const expectedAppDid = process.env.IMAJIN_APP_DID;
  if (expectedAppDid && identity.appDid !== expectedAppDid) {
    rmSync(resolveKeystorePath(process.env.IMAJIN_APP_KEYSTORE), { force: true });
    throw new AppDidMismatchError(expectedAppDid, identity.appDid);
  }

  writeSigningIdentity(identity);
  return identity;
}

/** Test-only: clears the in-memory signing identity between test cases. */
export function resetSigningIdentityForTests(): void {
  writeSigningIdentity(null);
}
