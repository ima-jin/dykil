import type { FetchRoute } from './fetch-mock';

export const PUBLISHED_SURVEY = {
  id: 's1',
  title: 'Event feedback',
  description: 'Tell us how it went',
  status: 'published',
  fields: { elements: [{ type: 'text', name: 'q1', title: 'How was it?' }] },
  settings: {},
};

export interface Journey {
  /** Body of `GET /api/surveys/s1`, or `{ status }` for a failure. */
  survey?: Partial<FetchRoute>;
  /** `false` = signed out. */
  signedIn?: boolean;
  gate?: Partial<FetchRoute>;
  existing?: Partial<FetchRoute>;
  prepare?: Partial<FetchRoute>;
  respond?: Partial<FetchRoute>;
}

/** The respondent journey's API surface, with sensible "signed in, open survey, no earlier response" defaults. */
export function journeyRoutes(journey: Journey = {}): FetchRoute[] {
  return [
    { match: '/dykil/api/session', ...(journey.signedIn === false ? { status: 401, body: {} } : { body: { did: 'did:imajin:me' } }) },
    { match: '/dykil/api/surveys/s1', body: PUBLISHED_SURVEY, ...journey.survey },
    { match: '/dykil/api/surveys/s1/gate', body: { gated: false, allowed: true }, ...journey.gate },
    { match: /\/dykil\/api\/surveys\/s1\/responses\/check/, body: { completed: false }, ...journey.existing },
    { method: 'POST', match: '/dykil/api/surveys/s1/respond/prepare', body: { canonical: '{"canonical":"payload"}', issuedAt: 1700 }, ...journey.prepare },
    { method: 'POST', match: '/dykil/api/surveys/s1/respond', status: 201, body: { response: { id: 'r-new' } }, ...journey.respond },
  ];
}
