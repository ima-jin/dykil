import { apiFetch, readError, readJson } from '@/lib/client/api';

export interface HandleSurvey {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
}

export type HandleSurveysResult =
  | { kind: 'ok'; surveys: HandleSurvey[] }
  | { kind: 'not-found' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

/** A handle's published surveys, from `GET /api/surveys/handle/:handle`. */
export async function loadHandleSurveys(handle: string): Promise<HandleSurveysResult> {
  let response: Response;
  try {
    response = await apiFetch(`/api/surveys/handle/${encodeURIComponent(handle)}`);
  } catch {
    return { kind: 'error', message: 'Network error — check your connection and try again' };
  }
  if (response.status === 404) return { kind: 'not-found' };
  if (response.status === 401) return { kind: 'signed-out' };
  if (!response.ok) return { kind: 'error', message: await readError(response, 'Failed to load surveys') };
  const body = await readJson<{ surveys?: HandleSurvey[] }>(response);
  return { kind: 'ok', surveys: body?.surveys ?? [] };
}
