'use client';

import { BUTTON_PRIMARY, PageMessage } from '@/components/ui';
import { signInUrlForCurrentPage } from '@/lib/client/auth';

/** Full-page "sign in first" screen that returns the visitor to where they were. */
export function SignInPrompt({ title, children }: Readonly<{ title: string; children?: React.ReactNode }>) {
  return (
    <PageMessage
      title={title}
      action={
        <a href={signInUrlForCurrentPage()} className={BUTTON_PRIMARY}>
          Sign in with Imajin
        </a>
      }
    >
      {children}
    </PageMessage>
  );
}
