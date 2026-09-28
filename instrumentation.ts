/**
 * Next.js instrumentation hook (stable since Next 15) — runs once when the
 * server process starts, before it serves any request. Not invoked by
 * `next build`, so CI builds are not gated on runtime secrets.
 *
 * This app is registered with the Imajin kernel (see docs/REGISTRATION.md)
 * and fetches its own vault-minted signing key at boot via
 * `@ima-jin/auth-client`'s `loadAppSigningKey()` (refs imajin-ai#2411) —
 * never a raw private key out of an env file. Refusing to boot without a
 * usable signing identity catches a misconfigured deploy immediately
 * instead of serving requests no kernel call can ever authenticate.
 */
import { bootstrapSigningIdentity } from '@/lib/auth/signing-identity';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  if (process.env.DYKIL_APP_PRIVATE_KEY) {
    throw new Error(
      'DYKIL_APP_PRIVATE_KEY is set, but this app no longer reads a signing key from env — ' +
        'remove it and see docs/REGISTRATION.md for the loadAppSigningKey() flow ' +
        '(IMAJIN_APP_KEYSTORE / IMAJIN_APP_CLAIM_CODE).'
    );
  }

  await bootstrapSigningIdentity();
}
