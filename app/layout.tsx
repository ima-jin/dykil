import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'dykil',
  description: 'Surveys & polls, rebuilt on Imajin kernel primitives (refs #1985).',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="flex items-center justify-between border-b border-gray-800/50 bg-gray-950/90 px-4 py-2 backdrop-blur">
            <span className="text-sm font-semibold text-white">dykil</span>
            <a
              className="text-xs text-amber-400 hover:underline"
              href={`${process.env.NEXT_PUBLIC_IMAJIN_AUTH_URL ?? ''}/auth`}
            >
              Sign in with Imajin
            </a>
          </header>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
