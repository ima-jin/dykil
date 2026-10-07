import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KernelProfileError, resolveHandleToDid } from '../profile';

describe('resolveHandleToDid', () => {
  beforeEach(() => {
    vi.stubEnv('IMAJIN_KERNEL_URL', 'https://dev-jin.imajin.ai');
    vi.stubEnv('PROFILE_SERVICE_URL', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const stub = (response: Response) => {
    const mock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('asks the kernel public profile API, with no credential, and returns the DID', async () => {
    const mock = stub(new Response(JSON.stringify({ did: 'did:imajin:alice', handle: 'alice' })));
    expect(await resolveHandleToDid('a b')).toBe('did:imajin:alice');
    expect(mock).toHaveBeenCalledWith('https://dev-jin.imajin.ai/profile/api/profile/a%20b', { cache: 'no-store' });
  });

  it.each([
    ['an unknown handle (404)', new Response('{}', { status: 404 })],
    ['a profile without a DID', new Response('{}')],
    ['a profile with an empty DID', new Response('{"did":""}')],
    ['a body that is not JSON', new Response('oops')],
  ])('returns null for %s', async (_label, response) => {
    stub(response);
    expect(await resolveHandleToDid('alice')).toBeNull();
  });

  it('throws KernelProfileError with the status for any other failure', async () => {
    stub(new Response('{}', { status: 503 }));
    await expect(resolveHandleToDid('alice')).rejects.toMatchObject({ name: 'KernelProfileError', status: 503 });
    await expect(resolveHandleToDid('alice')).rejects.toBeInstanceOf(KernelProfileError);
  });
});
