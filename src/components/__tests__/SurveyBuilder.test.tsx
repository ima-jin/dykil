// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigationMock, routerPush, setSearchParams } from '@/test/helpers/next-navigation-mock';
import { resetUiMock, toast } from '@/test/helpers/ui-mock';
import '@/test/helpers/survey-form-mock';

const { loadDraftMock } = vi.hoisted(() => ({ loadDraftMock: vi.fn() }));
vi.mock('@/lib/client/builder-api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/client/builder-api')>('@/lib/client/builder-api')),
  loadDraft: loadDraftMock,
}));

import { SurveyBuilder } from '../SurveyBuilder';

beforeEach(() => {
  resetNavigationMock();
  resetUiMock();
  loadDraftMock.mockReset();
});
afterEach(cleanup);

describe('SurveyBuilder (edit mode, unexpected failure)', () => {
  it('returns to the dashboard with an error if loading the survey rejects', async () => {
    setSearchParams('id=abc');
    loadDraftMock.mockRejectedValue(new Error('boom'));
    render(<SurveyBuilder />);

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/dashboard'));
    expect(toast.error).toHaveBeenCalledWith('Failed to load survey');
  });
});
