'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@ima-jin/ui';

/** Client-side context providers — the shared toast host every page reports through. */
export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return <ToastProvider>{children}</ToastProvider>;
}
