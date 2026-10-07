import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { buildServiceMetadata, defaultViewport } from '@ima-jin/ui/server';
import { Providers } from './providers';
import './globals.css';

export const viewport: Viewport = defaultViewport;
export const metadata: Metadata = buildServiceMetadata('Dykil', 'Sovereign surveys and polls on the Imajin network');

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
