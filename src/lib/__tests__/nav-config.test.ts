import { describe, expect, it } from 'vitest';
import { navConfig } from '../nav-config';

describe('navConfig', () => {
  it.each([
    ['a dev kernel origin', 'https://dev-jin.imajin.ai', { servicePrefix: 'https://dev-jin.imajin.ai', domain: 'dev-jin.imajin.ai' }],
    ['a prod kernel origin with a path', 'https://jin.imajin.ai/auth', { servicePrefix: 'https://jin.imajin.ai', domain: 'jin.imajin.ai' }],
    ['a localhost origin keeps its port in the domain', 'http://localhost:3000', { servicePrefix: 'http://localhost:3000', domain: 'localhost:3000' }],
    ['nothing configured', undefined, { servicePrefix: 'https://', domain: 'imajin.ai' }],
    ['an unparseable value', 'not a url', { servicePrefix: 'https://', domain: 'imajin.ai' }],
  ])('%s', (_label, origin, expected) => {
    expect(navConfig(origin)).toEqual(expected);
  });
});
