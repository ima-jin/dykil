import { describe, expect, it } from 'vitest';
import { forwardedIdentityHeaders } from '../forward';

describe('forwardedIdentityHeaders', () => {
  it("forwards only the caller's own cookie and authorization", () => {
    const request = new Request('https://dykil.imajin.ai', {
      headers: { cookie: 'imajin_session=abc', authorization: 'Bearer t', 'x-other': 'nope' },
    });
    expect(forwardedIdentityHeaders(request)).toEqual({ cookie: 'imajin_session=abc', authorization: 'Bearer t' });
  });

  it('forwards nothing for an anonymous request — it never substitutes its own identity', () => {
    expect(forwardedIdentityHeaders(new Request('https://dykil.imajin.ai'))).toEqual({});
  });
});
