'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInitialView } from '@/lib/client/runner-load';
import { prepareResponse, submitResponse, type SurveyView } from '@/lib/client/survey-api';
import { useSession } from '@/lib/client/use-session';

type Answers = Record<string, unknown>;

export interface SubmittedView {
  kind: 'submitted';
  survey: SurveyView;
  answers: Answers;
  responseId: string | null;
}

export type RunnerView =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; status: string }
  | { kind: 'error'; message: string }
  | { kind: 'sign-in'; survey: SurveyView }
  | { kind: 'ticket-required'; survey: SurveyView }
  | {
      kind: 'answering';
      survey: SurveyView;
      initialAnswers: Answers | null;
      error: string | null;
      preparing: boolean;
      /** Set while editing an earlier response, so Cancel can go back to it. */
      editing: SubmittedView | null;
    }
  | { kind: 'signing'; survey: SurveyView; answers: Answers; canonical: string; issuedAt: number; error: string | null; submitting: boolean }
  | SubmittedView;

type AnsweringView = Extract<RunnerView, { kind: 'answering' }>;
type SigningView = Extract<RunnerView, { kind: 'signing' }>;

function answeringView(survey: SurveyView, overrides: Partial<AnsweringView> = {}): AnsweringView {
  return { kind: 'answering', survey, initialAnswers: null, error: null, preparing: false, editing: null, ...overrides };
}

function fromInitial(initial: Awaited<ReturnType<typeof loadInitialView>>): RunnerView {
  return initial.kind === 'answering' ? answeringView(initial.survey) : initial;
}

/**
 * The respondent's journey through one survey: load → answer → sign → submitted
 * (→ edit, which supersedes the earlier response). `onCompleted` fires when a
 * response is recorded, and when an earlier one is found — what an events-page
 * embed relays to its parent.
 */
export function useSurveyRunner(params: {
  surveyId: string;
  ticketId: string | null;
  onCompleted?: (answers: Answers) => void;
}) {
  const { surveyId, ticketId } = params;
  const session = useSession();
  const [view, setView] = useState<RunnerView>({ kind: 'loading' });
  const supersedes = useRef<string | null>(null);
  const onCompleted = useRef(params.onCompleted);
  onCompleted.current = params.onCompleted;
  const signedIn = session.status === 'signed-in';

  useEffect(() => {
    if (session.status === 'loading') return undefined;
    let cancelled = false;
    loadInitialView(surveyId, ticketId, signedIn).then((initial) => {
      if (cancelled) return;
      if (initial.kind === 'submitted') onCompleted.current?.(initial.answers);
      setView(fromInitial(initial));
    });
    return () => {
      cancelled = true;
    };
  }, [surveyId, ticketId, signedIn, session.status]);

  const submitAnswers = useCallback(
    async (answers: Answers) => {
      if (view.kind !== 'answering') return;
      setView({ ...view, preparing: true, error: null });
      const prepared = await prepareResponse(surveyId, { answers, ticketId, supersedes: supersedes.current });
      if (!prepared.ok) {
        setView({ ...view, initialAnswers: answers, preparing: false, error: prepared.error });
        return;
      }
      const { canonical, issuedAt } = prepared.data;
      setView({ kind: 'signing', survey: view.survey, answers, canonical, issuedAt, error: null, submitting: false });
    },
    [view, surveyId, ticketId],
  );

  const submitSignature = useCallback(
    async (signature: string) => {
      if (view.kind !== 'signing') return;
      const signing: SigningView = view;
      setView({ ...signing, submitting: true, error: null });
      const result = await submitResponse(surveyId, {
        answers: signing.answers,
        ticketId,
        supersedes: supersedes.current,
        issuedAt: signing.issuedAt,
        signature,
      });
      if (!result.ok) {
        setView({ ...signing, submitting: false, error: result.error });
        return;
      }
      supersedes.current = null;
      setView({ kind: 'submitted', survey: signing.survey, answers: signing.answers, responseId: result.data.response?.id ?? null });
      onCompleted.current?.(signing.answers);
    },
    [view, surveyId, ticketId],
  );

  const backToAnswers = useCallback(() => {
    if (view.kind !== 'signing') return;
    setView(answeringView(view.survey, { initialAnswers: view.answers }));
  }, [view]);

  const startEdit = useCallback(() => {
    if (view.kind !== 'submitted') return;
    supersedes.current = view.responseId;
    setView(answeringView(view.survey, { initialAnswers: view.answers, editing: view }));
  }, [view]);

  const cancelEdit = useCallback(() => {
    if (view.kind !== 'answering' || !view.editing) return;
    supersedes.current = null;
    setView(view.editing);
  }, [view]);

  return { view, submitAnswers, submitSignature, backToAnswers, startEdit, cancelEdit };
}
