'use client';

import { useEffect, useState } from 'react';
import { apiFetch, readJson } from '@/lib/client/api';

export type SessionState = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; did: string };

async function toSessionState(response: Response): Promise<SessionState> {
  const body = response.ok ? await readJson<{ did?: string }>(response) : null;
  return body?.did ? { status: 'signed-in', did: body.did } : { status: 'signed-out' };
}

/** The caller's session, from this app's own `GET /api/session`. */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const apply = (next: SessionState) => {
      if (!cancelled) setSession(next);
    };
    apiFetch('/api/session')
      .then(toSessionState)
      .then(apply)
      .catch(() => apply({ status: 'signed-out' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}
