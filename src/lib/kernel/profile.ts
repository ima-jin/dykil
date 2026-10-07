import { profileServiceUrl } from '@/lib/env';

export class KernelProfileError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'KernelProfileError';
    this.status = status;
  }
}

/**
 * Resolve a handle to its DID through the kernel's public
 * `GET /profile/api/profile/{handle}` (no credential needed). Null when the
 * handle does not exist.
 */
export async function resolveHandleToDid(handle: string): Promise<string | null> {
  const response = await fetch(`${profileServiceUrl()}/api/profile/${encodeURIComponent(handle)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new KernelProfileError(`Profile lookup failed (${response.status})`, response.status);
  }
  const body = (await response.json().catch(() => null)) as { did?: unknown } | null;
  return typeof body?.did === 'string' && body.did.length > 0 ? body.did : null;
}
