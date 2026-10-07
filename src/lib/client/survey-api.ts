import { apiFetch, jsonInit, readError, readJson } from '@/lib/client/api';

/** What a browser call to this app's own API yields — never throws. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, init: RequestInit | undefined, fallback: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await apiFetch(path, init);
  } catch {
    return { ok: false, status: 0, error: 'Network error — check your connection and try again' };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: await readError(response, fallback) };
  }
  const data = await readJson<T>(response);
  if (data === null) return { ok: false, status: response.status, error: fallback };
  return { ok: true, data };
}

const enc = encodeURIComponent;

/** A survey document as `GET /api/surveys/:id` returns it. */
export interface SurveyView {
  id: string;
  title: string;
  description: string | null;
  fields: unknown;
  status: string;
  settings?: { eventId?: string; multipleResponses?: boolean };
  ownerDid?: string;
  createdAt?: string;
}

export function fetchSurvey(id: string): Promise<ApiResult<SurveyView>> {
  return call(`/api/surveys/${enc(id)}`, undefined, 'Survey not found');
}

export interface GateView {
  gated: boolean;
  allowed: boolean;
}

export function fetchGate(id: string): Promise<ApiResult<GateView>> {
  return call(`/api/surveys/${enc(id)}/gate`, undefined, 'Could not check ticket access');
}

export interface ExistingResponse {
  completed: boolean;
  responseId?: string;
  answers?: Record<string, unknown> | null;
}

export function fetchExistingResponse(id: string, ticketId: string | null): Promise<ApiResult<ExistingResponse>> {
  const query = new URLSearchParams({ include: 'answers' });
  if (ticketId) query.set('ticketId', ticketId);
  return call(`/api/surveys/${enc(id)}/responses/check?${query}`, undefined, 'Could not check your response');
}

export interface PreparedResponse {
  canonical: string;
  issuedAt: number;
}

export interface RespondInput {
  answers: Record<string, unknown>;
  ticketId: string | null;
  supersedes: string | null;
}

/** Only the fields that are set — the API treats an absent `ticketId`/`supersedes` as none. */
function respondBody(input: RespondInput): Record<string, unknown> {
  return {
    answers: input.answers,
    ...(input.ticketId ? { ticketId: input.ticketId } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
  };
}

export function prepareResponse(id: string, input: RespondInput): Promise<ApiResult<PreparedResponse>> {
  return call(`/api/surveys/${enc(id)}/respond/prepare`, jsonInit('POST', respondBody(input)), 'Could not prepare your response');
}

export function submitResponse(
  id: string,
  input: RespondInput & { issuedAt: number; signature: string },
): Promise<ApiResult<{ response?: { id?: string } }>> {
  const body = { ...respondBody(input), issuedAt: input.issuedAt, signature: input.signature };
  return call(`/api/surveys/${enc(id)}/respond`, jsonInit('POST', body), 'Failed to submit response');
}
