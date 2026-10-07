'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignInPrompt } from '@/components/SignInPrompt';
import { EmptyState, MUTED, PageMessage, Spinner } from '@/components/ui';
import { loadHandleSurveys, type HandleSurveysResult } from '@/lib/client/handle-api';

/** A handle's public profile listing: every published survey they own. */
export function HandleSurveys({ handle }: Readonly<{ handle: string }>) {
  const [result, setResult] = useState<HandleSurveysResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHandleSurveys(handle).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (!result) return <Spinner />;
  if (result.kind === 'signed-out') return <SignInPrompt title={`Sign in to see @${handle}'s surveys`} />;
  if (result.kind === 'not-found') return <PageMessage title="Profile not found">There is no one with the handle @{handle}.</PageMessage>;
  if (result.kind === 'error') return <PageMessage title="Could not load surveys">{result.message}</PageMessage>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-12 text-center">
        <h1 className="mb-2 text-4xl font-bold">@{handle}</h1>
        <p className={MUTED}>Published Surveys</p>
      </div>
      {result.surveys.length === 0 ? (
        <EmptyState icon="📊" title="No published surveys">
          This user hasn&apos;t published any surveys yet
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {result.surveys.map((survey) => (
            <li key={survey.id}>
              <Link
                href={`/${encodeURIComponent(handle)}/${encodeURIComponent(survey.id)}`}
                className="block rounded-lg border border-gray-200 bg-white p-6 text-left transition hover:border-orange-500 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:hover:border-orange-500"
              >
                <h2 className="mb-2 text-xl font-semibold">{survey.title}</h2>
                {survey.description && <p className={`mb-3 ${MUTED}`}>{survey.description}</p>}
                <div className="text-sm text-gray-500">Created {new Date(survey.createdAt).toLocaleDateString()}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
