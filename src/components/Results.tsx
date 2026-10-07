'use client';

import Link from 'next/link';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, EmptyState, MUTED, PageMessage, Spinner } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { downloadTextFile } from '@/lib/client/download';
import { loadResults, type ResultsData } from '@/lib/client/results-api';
import { useAsyncResult } from '@/lib/client/use-async-result';
import {
  aggregateResponses,
  answersOf,
  barEntries,
  buildCsv,
  csvFilename,
  formatAnswer,
  type FieldAggregate,
  type ResponseRow,
} from '@/lib/results';
import type { SurveyJSElement } from '@/lib/survey';

const FAILED: ResultsData = { kind: 'error', message: 'Something went wrong — try again' };
const BAR_TYPES = new Set(['radiogroup', 'dropdown', 'checkbox', 'boolean', 'rating']);
const LEGACY_PROVENANCE = 'node-witnessed-legacy-import';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function Bars({ aggregate }: Readonly<{ aggregate: FieldAggregate }>) {
  return (
    <div className="space-y-3">
      {barEntries(aggregate).map(({ label, count }) => {
        const percentage = aggregate.total > 0 ? (count / aggregate.total) * 100 : 0;
        return (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{label}</span>
              <span className="text-sm text-gray-500">
                {count} ({percentage.toFixed(1)}%)
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700">
              <div className="h-3 rounded-full bg-orange-500 transition-all" style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldBody({ aggregate }: Readonly<{ aggregate: FieldAggregate }>) {
  const { field } = aggregate;
  if (field.type === 'rating') {
    return (
      <div>
        <div className="mb-4 rounded-lg bg-orange-50 p-4 dark:bg-orange-900/20">
          <div className={`mb-1 text-sm ${MUTED}`}>Average Rating</div>
          <div className="text-3xl font-bold text-orange-500">
            {(aggregate.average ?? 0).toFixed(2)} / {Number(field.rateMax ?? 5)}
          </div>
        </div>
        <Bars aggregate={aggregate} />
      </div>
    );
  }
  if (BAR_TYPES.has(field.type)) return <Bars aggregate={aggregate} />;
  if (aggregate.texts.length === 0) return <div className="text-sm text-gray-500">No responses</div>;
  return (
    <ul className="space-y-3">
      {aggregate.texts.map(({ responseId, text }) => (
        <li key={responseId} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </li>
      ))}
    </ul>
  );
}

function FieldCard({ aggregate }: Readonly<{ aggregate: FieldAggregate }>) {
  return (
    <section className={CARD}>
      <h3 className="mb-4 text-xl font-semibold">{aggregate.field.title}</h3>
      <div className="mb-4 text-sm text-gray-500">{plural(aggregate.total, 'response')}</div>
      <FieldBody aggregate={aggregate} />
    </section>
  );
}

function IndividualResponses({ elements, rows }: Readonly<{ elements: SurveyJSElement[]; rows: ResponseRow[] }>) {
  return (
    <section className={`${CARD} mt-8`}>
      <h2 className="mb-4 text-xl font-semibold">Individual Responses</h2>
      <div className="space-y-4">
        {rows.map((row, index) => (
          <details key={row.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <summary className="cursor-pointer font-medium">
              Response #{rows.length - index} - {new Date(row.issuedAt).toLocaleString()}
              {row.payload?.provenance === LEGACY_PROVENANCE && (
                <span className="ml-2 rounded bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">legacy import</span>
              )}
            </summary>
            <dl className="mt-4 space-y-3 pl-4">
              {elements.map((field) => (
                <div key={field.name}>
                  <dt className={`text-sm font-medium ${MUTED}`}>{field.title}</dt>
                  <dd className="mt-1">
                    {formatAnswer(field, answersOf(row)[field.name]) || (
                      <span className="text-sm italic text-gray-400">No answer</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}

const DASHBOARD_LINK = (
  <Link href="/dashboard" className={BUTTON_PRIMARY}>
    Back to Dashboard
  </Link>
);

function ResultsBody({ data }: Readonly<{ data: Extract<ResultsData, { kind: 'ok' }> }>) {
  const { survey, elements, rows } = data;
  const aggregation = aggregateResponses(elements, rows);
  const exportCsv = () => downloadTextFile(csvFilename(survey.title), buildCsv(elements, rows), 'text/csv');

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{survey.title}</h1>
          <p className={`mt-1 ${MUTED}`}>{plural(rows.length, 'response')}</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={BUTTON_SECONDARY}>
            Export CSV
          </button>
          {DASHBOARD_LINK}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="📭" title="No responses yet">
          Share your survey to start collecting responses
        </EmptyState>
      ) : (
        <>
          <div className="space-y-8">
            {elements.map((field) => (
              <FieldCard key={field.name} aggregate={aggregation[field.name]} />
            ))}
          </div>
          <IndividualResponses elements={elements} rows={rows} />
        </>
      )}
    </div>
  );
}

function ResultsMessage({ data }: Readonly<{ data: Exclude<ResultsData, { kind: 'ok' }> }>) {
  switch (data.kind) {
    case 'signed-out':
      return <SignInPrompt title="Sign in to see results" />;
    case 'not-found':
      return <PageMessage title="Survey not found" action={DASHBOARD_LINK} />;
    case 'forbidden':
      return (
        <PageMessage title="Not your survey" action={DASHBOARD_LINK}>
          Only a survey&apos;s owner can see its responses.
        </PageMessage>
      );
    case 'error':
      return (
        <PageMessage title="Could not load results" action={DASHBOARD_LINK}>
          {data.message}
        </PageMessage>
      );
  }
}

/** A survey's results for its owner: per-question aggregates, every response, and a CSV export. */
export function Results({ surveyId }: Readonly<{ surveyId: string }>) {
  const { result: data } = useAsyncResult(() => loadResults(surveyId), FAILED, surveyId);

  if (!data) return <Spinner />;
  if (data.kind === 'ok') return <ResultsBody data={data} />;
  return <ResultsMessage data={data} />;
}
