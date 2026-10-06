import { describe, expect, it, vi } from 'vitest';
import { collectPages } from '../paginate';

describe('collectPages', () => {
  it('follows next until it is null, starting from a null cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], next: 'b' })
      .mockResolvedValueOnce({ items: [3], next: null });

    expect(await collectPages<number, string>(fetchPage, 10)).toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([null, 'b']);
  });

  it('returns a single page when next is null immediately', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: ['only'], next: null });
    expect(await collectPages<string, number>(fetchPage, 10)).toEqual(['only']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops at maxPages even when more pages are offered', async () => {
    let calls = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      calls += 1;
      return { items: [calls], next: calls };
    });
    expect(await collectPages<number, number>(fetchPage, 3)).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops when the cursor fails to advance', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: ['x'], next: 'stuck' });
    expect(await collectPages<string, string>(fetchPage, 10)).toEqual(['x', 'x']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('propagates a page failure', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(collectPages(fetchPage, 5)).rejects.toThrow('boom');
  });
});
