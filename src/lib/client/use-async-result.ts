'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader on mount and whenever `key` changes, keeping its result in
 * state. `failure` is what the screen shows if the loader rejects (the loaders
 * here never throw, but a screen must never be left spinning), and a result that
 * arrives after the screen is gone or `key` changed is dropped. `reload` re-runs
 * the loader on demand.
 */
export function useAsyncResult<T>(load: () => Promise<T>, failure: T, key: string): { result: T | null; reload: () => Promise<void> } {
  const [result, setResult] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const failureRef = useRef(failure);
  failureRef.current = failure;

  const reload = useCallback(async () => {
    setResult(await loadRef.current().catch(() => failureRef.current));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current()
      .catch(() => failureRef.current)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { result, reload };
}
