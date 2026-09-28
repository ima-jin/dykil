import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ENV_KEYS = [
  'AUTH_SERVICE_URL',
  'MEDIA_SERVICE_URL',
  'IMAJIN_APP_DID',
  'DYKIL_RESPONSE_ATTESTATION_TYPE',
  'DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE',
  'NEXT_PUBLIC_APP_URL',
] as const;

const originalEnv: Record<string, string | undefined> = {};

describe('src/lib/env', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('authServiceUrl returns the configured value', async () => {
    process.env.AUTH_SERVICE_URL = 'https://dev-jin.imajin.ai/auth';
    const { authServiceUrl } = await import('@/lib/env');
    expect(authServiceUrl()).toBe('https://dev-jin.imajin.ai/auth');
  });

  it('authServiceUrl throws when not set', async () => {
    const { authServiceUrl } = await import('@/lib/env');
    expect(() => authServiceUrl()).toThrow('AUTH_SERVICE_URL is not set');
  });

  it('mediaServiceUrl returns the configured value', async () => {
    process.env.MEDIA_SERVICE_URL = 'https://dev-jin.imajin.ai/media';
    const { mediaServiceUrl } = await import('@/lib/env');
    expect(mediaServiceUrl()).toBe('https://dev-jin.imajin.ai/media');
  });

  it('mediaServiceUrl throws when not set', async () => {
    const { mediaServiceUrl } = await import('@/lib/env');
    expect(() => mediaServiceUrl()).toThrow('MEDIA_SERVICE_URL is not set');
  });

  it('appDid returns undefined when not registered yet', async () => {
    const { appDid } = await import('@/lib/env');
    expect(appDid()).toBeUndefined();
  });

  it('appDid returns the configured DID', async () => {
    process.env.IMAJIN_APP_DID = 'did:imajin:dykil-app';
    const { appDid } = await import('@/lib/env');
    expect(appDid()).toBe('did:imajin:dykil-app');
  });

  it('responseAttestationType defaults when unset', async () => {
    const { responseAttestationType } = await import('@/lib/env');
    expect(responseAttestationType()).toBe('dykil/survey-response');
  });

  it('responseAttestationType honors an override', async () => {
    process.env.DYKIL_RESPONSE_ATTESTATION_TYPE = 'custom/type';
    const { responseAttestationType } = await import('@/lib/env');
    expect(responseAttestationType()).toBe('custom/type');
  });

  it('legacyImportAttestationType defaults when unset', async () => {
    const { legacyImportAttestationType } = await import('@/lib/env');
    expect(legacyImportAttestationType()).toBe('dykil/survey-response-legacy-import');
  });

  it('legacyImportAttestationType honors an override', async () => {
    process.env.DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE = 'custom/legacy-type';
    const { legacyImportAttestationType } = await import('@/lib/env');
    expect(legacyImportAttestationType()).toBe('custom/legacy-type');
  });

  it('thisAppHost defaults to dykil.imajin.ai when unset', async () => {
    const { thisAppHost } = await import('@/lib/env');
    expect(thisAppHost()).toBe('dykil.imajin.ai');
  });

  it('thisAppHost derives the host from a configured app URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://dykil.imajin.ai:8443/base';
    const { thisAppHost } = await import('@/lib/env');
    expect(thisAppHost()).toBe('dykil.imajin.ai:8443');
  });

  it('thisAppHost falls back when the configured app URL is invalid', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'not a url';
    const { thisAppHost } = await import('@/lib/env');
    expect(thisAppHost()).toBe('dykil.imajin.ai');
  });
});
