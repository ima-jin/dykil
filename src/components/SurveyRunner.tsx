'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignStep } from '@/components/SignStep';
import { SurveyForm } from '@/components/SurveyForm';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, MUTED, PageMessage, Spinner } from '@/components/ui';
import { signInUrlForCurrentPage } from '@/lib/client/auth';
import type { SurveyView } from '@/lib/client/survey-api';
import { useSurveyRunner, type RunnerView } from '@/lib/client/use-survey-runner';
import { buildSurveyJson } from '@/lib/survey-json';

export type RunnerVariant = 'page' | 'embed';

type Answers = Record<string, unknown>;

/** A screen-replacing message: a full page in the app, a compact panel inside an events-page iframe. */
function Message({
  variant,
  title,
  children,
}: Readonly<{ variant: RunnerVariant; title: string; children?: ReactNode }>) {
  if (variant === 'embed') {
    return (
      <div className="p-8 text-center">
        <p className="font-semibold">{title}</p>
        {children && <div className={`mt-2 ${MUTED}`}>{children}</div>}
      </div>
    );
  }
  return (
    <PageMessage
      title={title}
      action={
        <Link href="/" className={BUTTON_PRIMARY}>
          Back to Home
        </Link>
      }
    >
      {children}
    </PageMessage>
  );
}

function SurveyHeading({ survey, variant }: Readonly<{ survey: SurveyView; variant: RunnerVariant }>) {
  const Heading = variant === 'embed' ? 'h2' : 'h1';
  return (
    <div className="mb-6">
      <Heading className="mb-2 text-2xl font-bold">{survey.title}</Heading>
      {survey.description && <p className={MUTED}>{survey.description}</p>}
    </div>
  );
}

/** The card (page) or bare panel (embed) a survey screen sits in. */
function Frame({ variant, children }: Readonly<{ variant: RunnerVariant; children: ReactNode }>) {
  if (variant === 'embed') return <div className="p-6">{children}</div>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className={`${CARD} p-8`}>{children}</div>
    </div>
  );
}

function Answering({
  view,
  variant,
  onComplete,
  onCancelEdit,
}: Readonly<{
  view: Extract<RunnerView, { kind: 'answering' }>;
  variant: RunnerVariant;
  onComplete: (answers: Answers) => void;
  onCancelEdit: () => void;
}>) {
  const json = buildSurveyJson(view.survey.fields);
  let body: ReactNode;
  if (view.preparing) {
    body = <Spinner label="Preparing your response" />;
  } else if (json) {
    body = <SurveyForm json={json} initialAnswers={view.initialAnswers} onComplete={onComplete} />;
  } else {
    body = <p className={MUTED}>This survey has no questions yet.</p>;
  }
  return (
    <Frame variant={variant}>
      {view.editing && (
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold text-orange-500">Editing your response</span>
          <button type="button" onClick={onCancelEdit} className="text-sm text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      )}
      <SurveyHeading survey={view.survey} variant={variant} />
      {view.error && (
        <p role="alert" className="mb-4 text-sm text-red-500">
          {view.error}
        </p>
      )}
      {body}
    </Frame>
  );
}

function Submitted({ variant, onEdit }: Readonly<{ variant: RunnerVariant; onEdit: () => void }>) {
  return (
    <Frame variant={variant}>
      <div className="text-center">
        <div className="mb-3 text-5xl" aria-hidden="true">
          ✓
        </div>
        <h2 className="mb-1 text-xl font-bold">Response submitted</h2>
        <p className={`mb-4 ${MUTED}`}>Your response has been recorded.</p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={onEdit} className={BUTTON_SECONDARY}>
            Edit answers
          </button>
          {variant === 'page' && (
            <Link href="/" className={BUTTON_PRIMARY}>
              Back to Home
            </Link>
          )}
        </div>
      </div>
    </Frame>
  );
}

function ViewSwitch({
  runner,
  variant,
}: Readonly<{ runner: ReturnType<typeof useSurveyRunner>; variant: RunnerVariant }>) {
  const { view } = runner;
  switch (view.kind) {
    case 'loading':
      return <Spinner />;
    case 'not-found':
      return <Message variant={variant} title="Survey not found" />;
    case 'unavailable':
      return (
        <Message variant={variant} title="Survey not available">
          This survey is currently {view.status}.
        </Message>
      );
    case 'error':
      return (
        <Message variant={variant} title="Something went wrong">
          {view.message}
        </Message>
      );
    case 'sign-in':
      return (
        <Frame variant={variant}>
          <SurveyHeading survey={view.survey} variant={variant} />
          <p className={`mb-4 ${MUTED}`}>Responses are signed by your Imajin identity, so you need to sign in first.</p>
          <a href={signInUrlForCurrentPage()} target={variant === 'embed' ? '_top' : undefined} className={BUTTON_PRIMARY}>
            Sign in with Imajin
          </a>
        </Frame>
      );
    case 'ticket-required':
      return (
        <Message variant={variant} title="A ticket is required">
          This survey is for ticket holders of the event. Your account does not hold a ticket for it.
        </Message>
      );
    case 'answering':
      return <Answering view={view} variant={variant} onComplete={runner.submitAnswers} onCancelEdit={runner.cancelEdit} />;
    case 'signing':
      return (
        <Frame variant={variant}>
          <SignStep
            canonical={view.canonical}
            busy={view.submitting}
            error={view.error}
            onSubmit={runner.submitSignature}
            onBack={runner.backToAnswers}
          />
        </Frame>
      );
    case 'submitted':
      return <Submitted variant={variant} onEdit={runner.startEdit} />;
  }
}

/** Take one survey: the whole respondent journey, in the app (`page`) or an events-page iframe (`embed`). */
export function SurveyRunner({
  surveyId,
  ticketId = null,
  variant,
  onCompleted,
}: Readonly<{
  surveyId: string;
  ticketId?: string | null;
  variant: RunnerVariant;
  onCompleted?: (answers: Answers) => void;
}>) {
  const runner = useSurveyRunner({ surveyId, ticketId, onCompleted });
  return <ViewSwitch runner={runner} variant={variant} />;
}
