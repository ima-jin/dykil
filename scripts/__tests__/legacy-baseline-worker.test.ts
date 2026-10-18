import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BaselineMismatchError } from '../lib/legacy-baseline-core.mjs';

const { client, runMock } = vi.hoisted(() => ({
  client: { connect: vi.fn(), end: vi.fn() },
  runMock: vi.fn(),
}));
vi.mock('pg', () => ({ default: { Client: vi.fn(() => client) } }));
vi.mock('../lib/legacy-vault-boot.mjs', () => ({
  legacyBoot: { getConfig: () => ({ legacyDatabaseUrl: 'FAKE_TEST_URL_NOT_A_CONNECTION_STRING' }) },
}));
vi.mock('../lib/legacy-baseline-core.mjs', async (original) => ({
  ...await original<typeof import('../lib/legacy-baseline-core.mjs')>(),
  runLegacyBaseline: runMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  client.connect.mockResolvedValue(undefined);
  client.end.mockResolvedValue(undefined);
  runMock.mockResolvedValue({ status: 'verified', surveys: 2, responses: 3 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('baseline vault-configured worker', () => {
  it('reports verified counts and closes its client', async () => {
    const { runBaseline } = await import('../lib/legacy-baseline.mjs');
    expect(await runBaseline()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 surveys, 3 responses'));
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('reports a fresh database without writes', async () => {
    runMock.mockResolvedValue({ status: 'fresh-database' });
    const { runBaseline } = await import('../lib/legacy-baseline.mjs');
    expect(await runBaseline()).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Fresh database'));
  });

  it('retains schema mismatch exit status', async () => {
    runMock.mockRejectedValue(new BaselineMismatchError(['FAKE_SCHEMA_MISMATCH']));
    const { runBaseline } = await import('../lib/legacy-baseline.mjs');
    expect(await runBaseline()).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Nothing was changed'));
  });

  it('never prints a driver error message and tolerates close failure', async () => {
    client.connect.mockRejectedValue(new Error('FAKE_DRIVER_DETAIL_MUST_NOT_BE_LOGGED'));
    client.end.mockRejectedValue(new Error('FAKE_CLOSE_DETAIL_MUST_NOT_BE_LOGGED'));
    const { runBaseline } = await import('../lib/legacy-baseline.mjs');
    expect(await runBaseline()).toBe(2);
    expect(console.error).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith('Baseline failed: legacy database operation unavailable.');
  });
});
