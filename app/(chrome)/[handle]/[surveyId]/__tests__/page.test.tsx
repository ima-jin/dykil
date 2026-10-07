// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import '@/test/helpers/survey-form-mock';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { journeyRoutes } from '@/test/helpers/survey-journey';

import HandleSurveyPage from '../page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/[handle]/[surveyId] — the link shape the kernel app used', () => {
  it.each([
    ['a handle', 'alice'],
    ['the placeholder handle the old dashboard put in share links', 'survey'],
  ])('resolves by survey id and ignores %s', async (_label, handle) => {
    const mock = stubFetchRoutes(journeyRoutes());
    render(await HandleSurveyPage({ params: Promise.resolve({ handle, surveyId: 's1' }) }));

    expect(await screen.findByRole('heading', { name: 'Event feedback' })).toBeInTheDocument();
    expect(callLog(mock).map(([, path]) => path)).toContain('/dykil/api/surveys/s1');
  });

  it('decodes an encoded survey id', async () => {
    const mock = stubFetchRoutes([
      { match: '/dykil/api/session', body: { did: 'did:imajin:me' } },
      { match: '/dykil/api/surveys/a%20b', status: 404, body: {} },
    ]);
    render(await HandleSurveyPage({ params: Promise.resolve({ handle: 'alice', surveyId: 'a%20b' }) }));
    await screen.findByText('Survey not found');
    expect(callLog(mock).map(([, path]) => path)).toContain('/dykil/api/surveys/a%20b');
  });
});
