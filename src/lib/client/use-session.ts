'use client';

import { useEffect, useState } from 'react';
import { apiFetch, readJson } from '@/lib/client/api';

export type SessionState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; did: string };

/** The caller's session, from this app's own `GET /api/session`. */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/session')
      .then(async (response) => {
        const body = response.ok ? await readJson<{ did?: string }>(response) : null;
        return body?.did ? ({ status: 'signed-in', did: body.did } as const) : ({ status: 'signed-out' } as const);
      })
      .catch(() => ({ status: 'signed-out' }) as const)
      .then((next) => {
        if (!cancelled) setSession(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
