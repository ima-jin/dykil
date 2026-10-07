'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInitialView, type InitialView } from '@/lib/client/runner-load';
import { answeringView, prepareStep, signStep, type RunnerView } from '@/lib/client/runner-steps';
import { useSession } from '@/lib/client/use-session';

export type { RunnerView } from '@/lib/client/runner-steps';

type Answers = Record<string, unknown>;

function fromInitial(initial: InitialView): RunnerView {
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
  const sessionKnown = session.status !== 'loading';

  useEffect(() => {
    if (!sessionKnown) return undefined;
    let cancelled = false;
    loadInitialView(surveyId, ticketId, signedIn).then((initial) => {
      if (cancelled) return;
      if (initial.kind === 'submitted') onCompleted.current?.(initial.answers);
      setView(fromInitial(initial));
    });
    return () => {
      cancelled = true;
    };
  }, [surveyId, ticketId, signedIn, sessionKnown]);

  const context = useCallback(() => ({ surveyId, ticketId, supersedes: supersedes.current }), [surveyId, ticketId]);

  const submitAnswers = useCallback(
    async (answers: Answers) => {
      if (view.kind !== 'answering') return;
      setView({ ...view, preparing: true, error: null });
      setView(await prepareStep(context(), view, answers));
    },
    [view, context],
  );

  const submitSignature = useCallback(
    async (signature: string) => {
      if (view.kind !== 'signing') return;
      setView({ ...view, submitting: true, error: null });
      const next = await signStep(context(), view, signature);
      if (next.kind === 'submitted') {
        supersedes.current = null;
        onCompleted.current?.(next.answers);
      }
      setView(next);
    },
    [view, context],
  );

  const backToAnswers = useCallback(() => {
    if (view.kind === 'signing') setView(answeringView(view.survey, { initialAnswers: view.answers }));
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
