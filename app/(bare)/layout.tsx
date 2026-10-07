import type { ReactNode } from 'react';

/** Chrome-free shell for iframe embeds (events pages): no navigation, no footer. */
export default function BareLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
