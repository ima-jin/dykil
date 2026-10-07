// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import '@/test/helpers/survey-form-mock';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { journeyRoutes } from '@/test/helpers/survey-journey';

import SurveyPage from '../page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/survey/[id]', () => {
  it('takes the survey named in the URL', async () => {
    const mock = stubFetchRoutes(journeyRoutes());
    render(await SurveyPage({ params: Promise.resolve({ id: 's1' }) }));

    expect(await screen.findByRole('heading', { name: 'Event feedback' })).toBeInTheDocument();
    expect(screen.getByTestId('survey-form')).toBeInTheDocument();
    expect(callLog(mock).map(([, path]) => path)).toContain('/dykil/api/surveys/s1');
  });

  it('says so for an unknown survey', async () => {
    stubFetchRoutes([
      { match: '/dykil/api/session', body: { did: 'did:imajin:me' } },
      { match: '/dykil/api/surveys/nope', status: 404, body: { error: 'Survey not found' } },
    ]);
    render(await SurveyPage({ params: Promise.resolve({ id: 'nope' }) }));
    expect(await screen.findByText('Survey not found')).toBeInTheDocument();
  });
});
