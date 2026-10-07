// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetchRoutes } from '@/test/helpers/fetch-mock';

const { loadInitialViewMock } = vi.hoisted(() => ({ loadInitialViewMock: vi.fn() }));
vi.mock('../runner-load', () => ({ loadInitialView: loadInitialViewMock }));

import { useSurveyRunner } from '../use-survey-runner';

afterEach(() => {
  vi.unstubAllGlobals();
  loadInitialViewMock.mockReset();
});

describe('useSurveyRunner', () => {
  it('lands on an error screen, not a spinner, if loading the journey rejects unexpectedly', async () => {
    stubFetchRoutes([{ match: '/dykil/api/session', body: { did: 'did:imajin:me' } }]);
    loadInitialViewMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSurveyRunner({ surveyId: 's1', ticketId: null }));

    await waitFor(() => expect(result.current.view).toEqual({ kind: 'error', message: 'Something went wrong — try again' }));
  });

  it('does not touch the view after being unmounted', async () => {
    stubFetchRoutes([{ match: '/dykil/api/session', body: { did: 'did:imajin:me' } }]);
    let reject: (reason: Error) => void = () => undefined;
    loadInitialViewMock.mockReturnValue(new Promise((_, r) => (reject = r)));

    const { result, unmount } = renderHook(() => useSurveyRunner({ surveyId: 's1', ticketId: null }));
    await waitFor(() => expect(loadInitialViewMock).toHaveBeenCalled());
    unmount();
    reject(new Error('late'));
    await Promise.resolve();

    expect(result.current.view).toEqual({ kind: 'loading' });
  });
});
