import type { ReactNode } from 'react';
import { NavBar } from '@ima-jin/ui';
import { navConfig } from '@/lib/nav-config';

/** Screens with the shared Imajin navigation. Embeds live in `(bare)`, which has none. */
export default function ChromeLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { servicePrefix, domain } = navConfig();
  return (
    <>
      <NavBar currentService="Surveys" servicePrefix={servicePrefix} domain={domain} />
      {children}
    </>
  );
}
