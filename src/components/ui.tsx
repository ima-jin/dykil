import type { ReactNode } from 'react';

/** Shared class strings — one place for the app's orange-accent look. */
export const BUTTON_PRIMARY =
  'rounded-lg bg-orange-500 px-4 py-2 font-medium text-white transition hover:bg-orange-600 disabled:opacity-50';
export const BUTTON_SECONDARY =
  'rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';
export const BUTTON_DANGER =
  'rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20';
export const CARD = 'rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800';
export const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';
export const MUTED = 'text-gray-600 dark:text-gray-400';

export function Spinner({ label = 'Loading' }: Readonly<{ label?: string }>) {
  return (
    <output className="flex justify-center py-12" aria-label={label}>
      <span className="block h-12 w-12 animate-spin rounded-full border-t-2 border-orange-500" />
    </output>
  );
}

/** A centred message that replaces a screen's content (not found, unavailable, …). */
export function PageMessage({
  title,
  children,
  action,
}: Readonly<{ title: string; children?: ReactNode; action?: ReactNode }>) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-bold">{title}</h1>
      {children && <div className={`mb-6 ${MUTED}`}>{children}</div>}
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: Readonly<{ icon: string; title: string; children?: ReactNode }>) {
  return (
    <div className={`${CARD} py-16 text-center`}>
      <div className="mb-4 text-6xl" aria-hidden="true">
        {icon}
      </div>
      <h2 className="mb-2 text-2xl font-bold">{title}</h2>
      {children && <div className={MUTED}>{children}</div>}
    </div>
  );
}
