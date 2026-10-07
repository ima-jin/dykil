import { type ApiResult } from '@/lib/client/survey-api';
import { apiFetch, readError, readJson } from '@/lib/client/api';
import { withBasePath } from '@/lib/base-path';
import type { SurveyStatus } from '@/lib/survey';

export interface DashboardSurvey {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  createdAt: string;
  updatedAt: string;
  /** Active responses; null when the count could not be read. */
  responseCount: number | null;
}

export type DashboardResult = { kind: 'ok'; surveys: DashboardSurvey[] } | { kind: 'signed-out' } | { kind: 'error'; message: string };

async function responseCount(id: string): Promise<number | null> {
  try {
    const response = await apiFetch(`/api/surveys/${encodeURIComponent(id)}/responses`);
    if (!response.ok) return null;
    const body = await readJson<{ total?: number }>(response);
    return body?.total ?? 0;
  } catch {
    return null;
  }
}

/** The caller's surveys, each with its response count (read in parallel — one count call per survey). */
export async function loadDashboard(): Promise<DashboardResult> {
  let response: Response;
  try {
    response = await apiFetch('/api/surveys/mine');
  } catch {
    return { kind: 'error', message: 'Network error — check your connection and try again' };
  }
  if (response.status === 401) return { kind: 'signed-out' };
  if (!response.ok) return { kind: 'error', message: await readError(response, 'Failed to load your surveys') };

  const body = await readJson<{ surveys?: Array<Omit<DashboardSurvey, 'responseCount'>> }>(response);
  const surveys = await Promise.all(
    (body?.surveys ?? []).map(async (survey) => ({ ...survey, responseCount: await responseCount(survey.id) })),
  );
  return { kind: 'ok', surveys };
}

export async function deleteSurvey(id: string): Promise<ApiResult<null>> {
  try {
    const response = await apiFetch(`/api/surveys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) return { ok: false, status: response.status, error: await readError(response, 'Failed to delete survey') };
    return { ok: true, data: null };
  } catch {
    return { ok: false, status: 0, error: 'Network error — check your connection and try again' };
  }
}

/** The shareable respondent link: `<origin>/dykil/survey/<id>`. */
export function surveyShareUrl(origin: string, id: string): string {
  const path = withBasePath(`/survey/${encodeURIComponent(id)}`);
  return `${origin}${path}`;
}
