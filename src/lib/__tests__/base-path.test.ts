import { describe, expect, it, vi } from 'vitest';
import { withBasePath } from '../base-path';

describe('withBasePath', () => {
  it('prefixes a path with the default basePath', () => {
    expect(withBasePath('/api/health')).toBe('/dykil/api/health');
  });

  it('returns the basePath itself for root', () => {
    expect(withBasePath('/')).toBe('/dykil');
  });

  it('respects NEXT_PUBLIC_BASE_PATH env override', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/custom');
    expect(withBasePath('/api/spec')).toBe('/custom/api/spec');
    vi.unstubAllEnvs();
  });

  it('handles nested paths', () => {
    expect(withBasePath('/api/surveys/abc/respond')).toBe('/dykil/api/surveys/abc/respond');
  });
});
