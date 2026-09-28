import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bootstrapSigningIdentityMock } = vi.hoisted(() => ({ bootstrapSigningIdentityMock: vi.fn() }));

vi.mock('@/lib/auth/signing-identity', () => ({
  bootstrapSigningIdentity: bootstrapSigningIdentityMock,
}));

describe('instrumentation', () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrapSigningIdentityMock.mockReset().mockResolvedValue(undefined);
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.DYKIL_APP_PRIVATE_KEY;
  });

  it('does nothing outside the nodejs runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../instrumentation');

    await register();

    expect(bootstrapSigningIdentityMock).not.toHaveBeenCalled();
  });

  it('fails loud when a raw private-key env var is still present', async () => {
    process.env.DYKIL_APP_PRIVATE_KEY = 'deadbeef';
    const { register } = await import('../instrumentation');

    await expect(register()).rejects.toThrow('DYKIL_APP_PRIVATE_KEY');
    expect(bootstrapSigningIdentityMock).not.toHaveBeenCalled();
  });

  it('bootstraps the signing identity on a nodejs boot', async () => {
    const { register } = await import('../instrumentation');

    await register();

    expect(bootstrapSigningIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a bootstrap failure instead of swallowing it', async () => {
    bootstrapSigningIdentityMock.mockRejectedValue(new Error('loadAppSigningKey: could not reach the kernel'));
    const { register } = await import('../instrumentation');

    await expect(register()).rejects.toThrow('loadAppSigningKey: could not reach the kernel');
  });
});
