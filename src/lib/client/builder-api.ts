import { apiFetch, jsonInit, readError, readJson } from '@/lib/client/api';
import { fetchSurvey, type ApiResult } from '@/lib/client/survey-api';
import type { QuestionElement } from '@/lib/survey-builder';
import { flattenElements } from '@/lib/survey-json';
import type { SurveySettings, SurveyStatus } from '@/lib/survey';

/** A survey as the builder edits it. */
export interface SurveyDraft {
  title: string;
  description: string;
  elements: QuestionElement[];
  status: SurveyStatus;
  type: string;
  settings: SurveySettings;
}

export const EMPTY_DRAFT: SurveyDraft = { title: '', description: '', elements: [], status: 'draft', type: 'survey', settings: {} };

/** Load an existing survey into the builder (multi-page surveys are flattened into one question list). */
export async function loadDraft(id: string): Promise<ApiResult<SurveyDraft>> {
  const result = await fetchSurvey(id);
  if (!result.ok) return result;
  const { data } = result;
  return {
    ok: true,
    data: {
      title: data.title,
      description: data.description ?? '',
      elements: flattenElements(data.fields) as QuestionElement[],
      status: data.status as SurveyStatus,
      type: (data as { type?: string }).type ?? 'survey',
      settings: data.settings ?? {},
    },
  };
}

/** Drop an empty `eventId` — "no ticket gate" is the absence of the key, not an empty string. */
function cleanSettings(settings: SurveySettings): SurveySettings {
  const { eventId, ...rest } = settings;
  return eventId?.trim() ? { ...rest, eventId: eventId.trim() } : rest;
}

/** Create (`editId` null) or update a survey; `publish` moves it to `published`. */
export async function saveDraft(editId: string | null, draft: SurveyDraft, publish: boolean): Promise<ApiResult<{ id?: string }>> {
  const body = {
    title: draft.title,
    description: draft.description,
    fields: { elements: draft.elements },
    type: draft.type,
    status: publish ? 'published' : draft.status,
    settings: cleanSettings(draft.settings),
  };
  try {
    const response = await apiFetch(editId ? `/api/surveys/${encodeURIComponent(editId)}` : '/api/surveys', jsonInit(editId ? 'PUT' : 'POST', body));
    if (!response.ok) return { ok: false, status: response.status, error: await readError(response, 'Failed to save survey') };
    return { ok: true, data: (await readJson<{ id?: string }>(response)) ?? {} };
  } catch {
    return { ok: false, status: 0, error: 'Network error — check your connection and try again' };
  }
}
