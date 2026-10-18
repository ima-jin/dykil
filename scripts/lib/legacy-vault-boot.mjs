import { createVaultBoot } from '@ima-jin/auth-client';

/**
 * Server-only, memory-only configuration for the two legacy DB commands.
 * No application/DB imports belong above this boundary. The browser claim
 * must already have established this app's bootstrap keystore.
 * @typedef {{ legacyDatabaseUrl: string }} LegacyConfig
 */

/** @type {import('@ima-jin/auth-client').VaultBoot<LegacyConfig>} */
export const legacyBoot = createVaultBoot({
  vault: {
    keys: [{ key: 'LEGACY_DATABASE_URL', onMissing: 'fail' }],
  },
  configure: ({ values }) => {
    const legacyDatabaseUrl = values.LEGACY_DATABASE_URL;
    if (!legacyDatabaseUrl) {
      throw new Error('Required legacy credential unavailable');
    }
    return { legacyDatabaseUrl };
  },
});
