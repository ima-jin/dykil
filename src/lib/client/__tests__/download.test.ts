// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '../download';

afterEach(() => vi.restoreAllMocks());

describe('downloadTextFile', () => {
  it('saves the text through a temporary object URL, then releases it', () => {
    const createObjectURL = vi.fn(() => 'blob:abc');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:abc');
      expect(this.download).toBe('results.csv');
    });

    downloadTextFile('results.csv', 'a,b', 'text/csv');

    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/csv', size: 3 }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:abc');
  });
});
