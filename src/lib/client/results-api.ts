import { apiFetch, readError, readJson } from '@/lib/client/api';
import { fetchSurvey, type SurveyView } from '@/lib/client/survey-api';
import type { ResponseRow } from '@/lib/results';
import { flattenElements } from '@/lib/survey-json';
import type { SurveyJSElement } from '@/lib/survey';

export type ResultsData =
  | { kind: 'ok'; survey: SurveyView; elements: SurveyJSElement[]; rows: ResponseRow[] }
  | { kind: 'signed-out' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

const NETWORK_ERROR = 'Network error — check your connection and try again';

async function fetchRows(surveyId: string): Promise<{ rows: ResponseRow[] } | { status: number; message: string }> {
  try {
    const response = await apiFetch(`/api/surveys/${encodeURIComponent(surveyId)}/responses`);
    if (!response.ok) return { status: response.status, message: await readError(response, 'Failed to load responses') };
    const body = await readJson<{ responses?: ResponseRow[] }>(response);
    return { rows: body?.responses ?? [] };
  } catch {
    return { status: 0, message: NETWORK_ERROR };
  }
}

/** The owner's view of a survey: its questions and every active response. */
export async function loadResults(surveyId: string): Promise<ResultsData> {
  const [survey, responses] = await Promise.all([fetchSurvey(surveyId), fetchRows(surveyId)]);
  if (!survey.ok && survey.status === 404) return { kind: 'not-found' };
  if ('status' in responses) {
    if (responses.status === 401) return { kind: 'signed-out' };
    if (responses.status === 403) return { kind: 'forbidden' };
    if (responses.status === 404) return { kind: 'not-found' };
    return { kind: 'error', message: responses.message };
  }
  if (!survey.ok) return { kind: 'error', message: survey.error };
  return { kind: 'ok', survey: survey.data, elements: flattenElements(survey.data.fields), rows: responses.rows };
}
