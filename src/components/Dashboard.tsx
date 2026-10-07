'use client';

import Link from 'next/link';
import { useToast } from '@ima-jin/ui';
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, EmptyState, MUTED, PageMessage, Spinner } from '@/components/ui';
import { SignInPrompt } from '@/components/SignInPrompt';
import { useAsyncResult } from '@/lib/client/use-async-result';
import { deleteSurvey, loadDashboard, surveyShareUrl, type DashboardResult, type DashboardSurvey } from '@/lib/client/dashboard-api';

const FAILED: DashboardResult = { kind: 'error', message: 'Something went wrong — try again' };

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400',
  closed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function pluralResponses(count: number): string {
  return `${count} response${count === 1 ? '' : 's'}`;
}

function SurveyRow({
  survey,
  onCopy,
  onDelete,
}: Readonly<{ survey: DashboardSurvey; onCopy: (id: string) => void; onDelete: (id: string) => void }>) {
  return (
    <li className={`${CARD} transition hover:shadow-md`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-xl font-semibold">{survey.title}</h3>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[survey.status] ?? STATUS_BADGE.draft}`}>
              {survey.status}
            </span>
          </div>
          {survey.description && <p className={`mb-3 line-clamp-2 ${MUTED}`}>{survey.description}</p>}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>{pluralResponses(survey.responseCount ?? 0)}</span>
            <span aria-hidden="true">•</span>
            <span>Created {new Date(survey.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {survey.status === 'published' && (
            <button type="button" onClick={() => onCopy(survey.id)} className={BUTTON_SECONDARY} title="Copy survey link">
              Copy Link
            </button>
          )}
          <Link href={`/create?id=${encodeURIComponent(survey.id)}`} className={BUTTON_SECONDARY}>
            Edit
          </Link>
          <Link href={`/survey/${encodeURIComponent(survey.id)}/results`} className={`${BUTTON_PRIMARY} text-sm`}>
            View Results
          </Link>
          <button type="button" onClick={() => onDelete(survey.id)} className={BUTTON_DANGER}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function SurveyList({
  surveys,
  onCopy,
  onDelete,
}: Readonly<{ surveys: DashboardSurvey[]; onCopy: (id: string) => void; onDelete: (id: string) => void }>) {
  if (surveys.length === 0) {
    return (
      <EmptyState icon="📊" title="No surveys yet">
        <p className="mb-6">Create your first survey to get started.</p>
        <Link href="/create" className={BUTTON_PRIMARY}>
          Create Your First Survey
        </Link>
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-4">
      {surveys.map((survey) => (
        <SurveyRow key={survey.id} survey={survey} onCopy={onCopy} onDelete={onDelete} />
      ))}
    </ul>
  );
}

/** The owner's surveys with response counts — the screen after sign-in. */
export function Dashboard() {
  const { toast } = useToast();
  const { result, reload } = useAsyncResult(loadDashboard, FAILED, 'dashboard');

  const copyLink = async (id: string) => {
    await navigator.clipboard.writeText(surveyShareUrl(globalThis.location.origin, id));
    toast.success('Survey link copied!');
  };

  const remove = async (id: string) => {
    if (!globalThis.confirm('Are you sure you want to delete this survey? This action cannot be undone.')) return;
    const outcome = await deleteSurvey(id);
    if (outcome.ok) {
      await reload();
    } else {
      toast.error(outcome.error);
    }
  };

  if (!result) return <Spinner />;
  if (result.kind === 'signed-out') return <SignInPrompt title="Sign in to see your surveys" />;
  if (result.kind === 'error') return <PageMessage title="Could not load your surveys">{result.message}</PageMessage>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Surveys</h1>
          <p className={`mt-1 ${MUTED}`}>Manage your surveys and view responses</p>
        </div>
        <Link href="/create" className={BUTTON_PRIMARY}>
          Create Survey
        </Link>
      </div>
      <SurveyList surveys={result.surveys} onCopy={copyLink} onDelete={remove} />
    </div>
  );
}
