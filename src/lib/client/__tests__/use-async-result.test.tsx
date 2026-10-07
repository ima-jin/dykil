// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncResult } from '../use-async-result';

describe('useAsyncResult', () => {
  it('starts empty, then holds the loader’s result', async () => {
    const { result } = renderHook(() => useAsyncResult(() => Promise.resolve('loaded'), 'failed', 'k'));
    expect(result.current.result).toBeNull();
    await waitFor(() => expect(result.current.result).toBe('loaded'));
  });

  it('shows the failure value when the loader rejects, rather than spinning forever', async () => {
    const { result } = renderHook(() => useAsyncResult(() => Promise.reject(new Error('boom')), 'failed', 'k'));
    await waitFor(() => expect(result.current.result).toBe('failed'));
  });

  it('loads again when the key changes', async () => {
    const load = vi.fn((key: string) => Promise.resolve(`for ${key}`));
    const { result, rerender } = renderHook(({ key }) => useAsyncResult(() => load(key), 'failed', key), { initialProps: { key: 'a' } });
    await waitFor(() => expect(result.current.result).toBe('for a'));
    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.result).toBe('for b'));
  });

  it('drops an answer that arrives after the screen is gone', async () => {
    let resolve: (value: string) => void = () => undefined;
    const { result, unmount } = renderHook(() => useAsyncResult(() => new Promise<string>((r) => (resolve = r)), 'failed', 'k'));
    unmount();
    resolve('late');
    await Promise.resolve();
    expect(result.current.result).toBeNull();
  });

  it('reloads on demand, and a failing reload shows the failure value', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useAsyncResult(() => (++calls === 1 ? Promise.resolve('first') : Promise.reject(new Error('boom'))), 'failed', 'k'),
    );
    await waitFor(() => expect(result.current.result).toBe('first'));
    await act(() => result.current.reload());
    expect(result.current.result).toBe('failed');
  });
});
