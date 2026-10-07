import { fetchExistingResponse, fetchGate, fetchSurvey, type SurveyView } from '@/lib/client/survey-api';

/** Where a respondent lands once the survey, their session, the ticket gate and any earlier response are known. */
export type InitialView =
  | { kind: 'not-found' }
  | { kind: 'unavailable'; status: string }
  | { kind: 'error'; message: string }
  | { kind: 'sign-in'; survey: SurveyView }
  | { kind: 'ticket-required'; survey: SurveyView }
  | { kind: 'answering'; survey: SurveyView }
  | { kind: 'submitted'; survey: SurveyView; answers: Record<string, unknown>; responseId: string | null };

/**
 * The checks before a form is shown, in order: the survey exists and is
 * published; the visitor is signed in (a response is signed by an identity);
 * the ticket gate admits them (ticket-gated surveys); they have not already
 * responded. Each failure maps to its own screen; none degrades to "allowed".
 */
export async function loadInitialView(surveyId: string, ticketId: string | null, signedIn: boolean): Promise<InitialView> {
  const surveyResult = await fetchSurvey(surveyId);
  if (!surveyResult.ok) {
    return surveyResult.status === 404 ? { kind: 'not-found' } : { kind: 'error', message: surveyResult.error };
  }
  const survey = surveyResult.data;
  if (survey.status !== 'published') return { kind: 'unavailable', status: survey.status };
  if (!signedIn) return { kind: 'sign-in', survey };

  const gate = await fetchGate(surveyId);
  if (!gate.ok) return { kind: 'error', message: gate.error };
  if (!gate.data.allowed) return { kind: 'ticket-required', survey };

  const existing = await fetchExistingResponse(surveyId, ticketId);
  // A failed lookup is non-fatal: show the form; the server still refuses a duplicate.
  if (existing.ok && existing.data.completed && existing.data.answers) {
    return { kind: 'submitted', survey, answers: existing.data.answers, responseId: existing.data.responseId ?? null };
  }
  return { kind: 'answering', survey };
}
