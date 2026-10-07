import { prepareResponse, submitResponse, type SurveyView } from '@/lib/client/survey-api';

type Answers = Record<string, unknown>;

export interface SubmittedView {
  kind: 'submitted';
  survey: SurveyView;
  answers: Answers;
  responseId: string | null;
}

export interface AnsweringView {
  kind: 'answering';
  survey: SurveyView;
  initialAnswers: Answers | null;
  error: string | null;
  preparing: boolean;
  /** Set while editing an earlier response, so Cancel can go back to it. */
  editing: SubmittedView | null;
}

export interface SigningView {
  kind: 'signing';
  survey: SurveyView;
  answers: Answers;
  canonical: string;
  issuedAt: number;
  error: string | null;
  submitting: boolean;
}

export type RunnerView =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; status: string }
  | { kind: 'error'; message: string }
  | { kind: 'sign-in'; survey: SurveyView }
  | { kind: 'ticket-required'; survey: SurveyView }
  | AnsweringView
  | SigningView
  | SubmittedView;

export interface StepContext {
  surveyId: string;
  ticketId: string | null;
  /** The earlier response being edited, or null for a first response. */
  supersedes: string | null;
}

export function answeringView(survey: SurveyView, overrides: Partial<AnsweringView> = {}): AnsweringView {
  return { kind: 'answering', survey, initialAnswers: null, error: null, preparing: false, editing: null, ...overrides };
}

/** Answers are in: ask the server what must be signed. Failure keeps the answers and shows why. */
export async function prepareStep(context: StepContext, view: AnsweringView, answers: Answers): Promise<AnsweringView | SigningView> {
  const prepared = await prepareResponse(context.surveyId, { answers, ticketId: context.ticketId, supersedes: context.supersedes });
  if (!prepared.ok) return { ...view, initialAnswers: answers, preparing: false, error: prepared.error };
  const { canonical, issuedAt } = prepared.data;
  return { kind: 'signing', survey: view.survey, answers, canonical, issuedAt, error: null, submitting: false };
}

/** The respondent's own signature is in: relay it. Failure stays on the signing step with the reason. */
export async function signStep(context: StepContext, view: SigningView, signature: string): Promise<SigningView | SubmittedView> {
  const result = await submitResponse(context.surveyId, {
    answers: view.answers,
    ticketId: context.ticketId,
    supersedes: context.supersedes,
    issuedAt: view.issuedAt,
    signature,
  });
  if (!result.ok) return { ...view, submitting: false, error: result.error };
  return { kind: 'submitted', survey: view.survey, answers: view.answers, responseId: result.data.response?.id ?? null };
}
