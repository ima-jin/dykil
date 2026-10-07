import { describe, expect, it, vi } from 'vitest';
import { postToParent, resolveParentOrigin } from '../embed-protocol';

describe('resolveParentOrigin', () => {
  it.each([
    ['an explicit origin wins over the referrer', 'https://events.example', 'https://other.example/page', 'https://events.example'],
    ['the referrer origin otherwise', null, 'https://dev-jin.imajin.ai/events/e/1?x=y', 'https://dev-jin.imajin.ai'],
    ['null with no referrer', null, '', null],
    ['null with an unparseable referrer', null, 'not a url', null],
  ])('%s', (_label, explicit, referrer, expected) => {
    expect(resolveParentOrigin(explicit, referrer)).toBe(expected);
  });
});

describe('postToParent', () => {
  const message = { type: 'survey-height', height: 120 } as const;

  it('posts to the resolved origin, never "*"', () => {
    const parent = { postMessage: vi.fn() };
    expect(postToParent(message, 'https://events.example', parent)).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith(message, 'https://events.example');
  });

  it.each([
    ['no target origin', null, { postMessage: vi.fn() }],
    ['no parent window', 'https://events.example', null],
  ])('does nothing with %s', (_label, origin, parent) => {
    expect(postToParent(message, origin, parent)).toBe(false);
    if (parent) expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
