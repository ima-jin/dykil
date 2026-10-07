'use client';

import Link from 'next/link';
import { BUTTON_PRIMARY } from '@/components/ui';
import { signInUrl } from '@/lib/client/auth';
import { withBasePath } from '@/lib/base-path';
import { useSession } from '@/lib/client/use-session';

const CTA = `${BUTTON_PRIMARY} inline-block px-8 py-4 text-lg font-semibold`;

/** Sign in when nobody is, otherwise straight to "my surveys" and "create". */
export function LandingActions() {
  const session = useSession();
  if (session.status === 'loading') return <div className="mb-12 h-16" />;

  if (session.status === 'signed-in') {
    return (
      <div className="mb-12 flex justify-center gap-4">
        <Link href="/dashboard" className={CTA}>
          My Surveys →
        </Link>
        <Link href="/create" className={CTA}>
          Create a Survey
        </Link>
      </div>
    );
  }
  return (
    <div className="mb-12 flex justify-center">
      <a href={signInUrl(`${globalThis.location.origin}${withBasePath('/dashboard')}`)} className={CTA}>
        Sign In to Get Started
      </a>
    </div>
  );
}
