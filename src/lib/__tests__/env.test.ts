import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ENV_KEYS = [
  'AUTH_SERVICE_URL',
  'MEDIA_SERVICE_URL',
  'IMAJIN_APP_DID',
  'DYKIL_RESPONSE_ATTESTATION_TYPE',
  'DYKIL_LEGACY_IMPORT_ATTESTATION_TYPE',
  'NEXT_PUBLIC_APP_URL',
  'EVENTS_SERVICE_URL',
  'IMAJIN_KERNEL_URL',
  'PROFILE_SERVICE_URL',
  'DYKIL_EVENTS_AUTHORIZATION_ID',
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

  it('APP_SLUG is the registry slug, independent of NEXT_PUBLIC_APP_URL (imajin-ai#2706)', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://dev-jin.imajin.ai/dykil';
    const { APP_SLUG } = await import('@/lib/env');
    expect(APP_SLUG).toBe('dykil');
  });

  it('eventsServiceUrl is undefined when unset or empty, and returns the configured value otherwise', async () => {
    const { eventsServiceUrl } = await import('@/lib/env');
    expect(eventsServiceUrl()).toBeUndefined();
    process.env.EVENTS_SERVICE_URL = '';
    expect(eventsServiceUrl()).toBeUndefined();
    process.env.EVENTS_SERVICE_URL = 'https://dev-jin.imajin.ai/events';
    expect(eventsServiceUrl()).toBe('https://dev-jin.imajin.ai/events');
  });

  it('eventsGateAuthorizationId is undefined when unset or empty, and returns the configured value otherwise', async () => {
    const { eventsGateAuthorizationId } = await import('@/lib/env');
    expect(eventsGateAuthorizationId()).toBeUndefined();
    process.env.DYKIL_EVENTS_AUTHORIZATION_ID = '';
    expect(eventsGateAuthorizationId()).toBeUndefined();
    process.env.DYKIL_EVENTS_AUTHORIZATION_ID = 'att_consent_1';
    expect(eventsGateAuthorizationId()).toBe('att_consent_1');
  });

  it.each([
    ['derives it from the kernel origin', { IMAJIN_KERNEL_URL: 'https://dev-jin.imajin.ai' }, 'https://dev-jin.imajin.ai/profile'],
    ['ignores a trailing slash on the kernel origin', { IMAJIN_KERNEL_URL: 'https://jin.imajin.ai/' }, 'https://jin.imajin.ai/profile'],
    ['lets PROFILE_SERVICE_URL override it', { IMAJIN_KERNEL_URL: 'https://x', PROFILE_SERVICE_URL: 'https://p.test/profile' }, 'https://p.test/profile'],
  ])('profileServiceUrl %s', async (_label, vars, expected) => {
    Object.assign(process.env, vars);
    const { profileServiceUrl } = await import('@/lib/env');
    expect(profileServiceUrl()).toBe(expected);
  });

  it('profileServiceUrl throws when neither the kernel origin nor an override is set', async () => {
    const { profileServiceUrl } = await import('@/lib/env');
    expect(() => profileServiceUrl()).toThrow('IMAJIN_KERNEL_URL is not set');
  });
});
