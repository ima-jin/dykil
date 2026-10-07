// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigationMock, routerPush, setSearchParams } from '@/test/helpers/next-navigation-mock';
import { resetUiMock, toast } from '@/test/helpers/ui-mock';
import '@/test/helpers/survey-form-mock';
import { callLog, stubFetchRoutes, type FetchRoute } from '@/test/helpers/fetch-mock';

import CreatePage from '../page';

beforeEach(() => {
  resetNavigationMock();
  resetUiMock();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const saved: FetchRoute = { method: 'POST', match: '/dykil/api/surveys', status: 201, body: { id: 'new' } };
const posted = (mock: ReturnType<typeof stubFetchRoutes>) => callLog(mock).find(([method]) => method === 'POST' || method === 'PUT');

async function addQuestion(button: string, title: string) {
  await userEvent.click(screen.getByRole('button', { name: `+ ${button}` }));
  await userEvent.type(screen.getByLabelText('Question Text *'), title);
  await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));
}

describe('/create — new survey', () => {
  it('builds a survey and saves it as a draft through /api/surveys', async () => {
    const mock = stubFetchRoutes([saved]);
    render(<CreatePage />);
    expect(screen.getByRole('heading', { name: 'Create Survey' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Title *'), 'Feedback');
    await userEvent.type(screen.getByLabelText('Description'), 'Tell us');
    await addQuestion('Text', 'How was it?');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/dashboard'));
    const [method, path, body] = posted(mock) as [string, string, { fields: { elements: Array<{ title: string; type: string }> } }];
    expect([method, path]).toEqual(['POST', '/dykil/api/surveys']);
    expect(body).toMatchObject({ title: 'Feedback', description: 'Tell us', status: 'draft', type: 'survey', settings: {} });
    expect(body.fields.elements).toMatchObject([{ type: 'text', title: 'How was it?', isRequired: false }]);
  });

  it('publishes', async () => {
    const mock = stubFetchRoutes([saved]);
    render(<CreatePage />);
    await userEvent.type(screen.getByLabelText('Title *'), 'Poll');
    await addQuestion('Yes/No', 'Ok?');
    await userEvent.click(screen.getByRole('button', { name: 'Publish Survey' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/dashboard'));
    expect(posted(mock)?.[2]).toMatchObject({ status: 'published' });
  });

  it.each([
    ['a survey without a title', async () => addQuestion('Text', 'Q'), 'Survey title is required'],
    [
      'a survey without questions',
      async () => userEvent.type(screen.getByLabelText('Title *'), 'T'),
      'Survey must have at least one question',
    ],
  ])('refuses to save %s', async (_label, prepare, warning) => {
    const mock = stubFetchRoutes([saved]);
    render(<CreatePage />);
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));

    expect(toast.warning).toHaveBeenCalledWith(warning);
    expect(posted(mock)).toBeUndefined();
  });

  it('shows the API’s reason and stays put when saving fails', async () => {
    stubFetchRoutes([{ ...saved, status: 403, body: { error: 'Missing required scope(s): dykil:write' } }]);
    render(<CreatePage />);
    await userEvent.type(screen.getByLabelText('Title *'), 'T');
    await addQuestion('Text', 'Q');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Missing required scope(s): dykil:write'));
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save as Draft' })).toBeEnabled();
  });

  it('saves the ticket gate and multiple-response settings', async () => {
    const mock = stubFetchRoutes([saved]);
    render(<CreatePage />);
    await userEvent.type(screen.getByLabelText('Title *'), 'T');
    await addQuestion('Text', 'Q');
    await userEvent.click(screen.getByLabelText('Allow more than one response per person'));
    await userEvent.type(screen.getByLabelText(/Ticket-holders only/), 'event_1');
    await userEvent.click(screen.getByRole('button', { name: 'Publish Survey' }));

    await waitFor(() => expect(posted(mock)).toBeDefined());
    expect(posted(mock)?.[2]).toMatchObject({ settings: { multipleResponses: true, eventId: 'event_1' } });
  });

  describe('questions', () => {
    it('shows a live preview as questions are added', async () => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      expect(screen.getByText('Preview will appear here as you add questions')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Title *'), 'My poll');
      await addQuestion('Text', 'Q');

      const preview = screen.getByTestId('survey-form');
      expect(preview).toHaveAttribute('data-preview', 'true');
      expect(screen.getByRole('heading', { name: 'My poll' })).toBeInTheDocument();
    });

    it('falls back to "Untitled Survey" and shows the description in the preview', async () => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      expect(screen.getByRole('heading', { name: 'Untitled Survey' })).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Description'), 'About it');
      expect(screen.getByText('About it', { selector: 'p' })).toBeInTheDocument();
    });

    it('builds a multiple choice question: add, edit and remove choices', async () => {
      const mock = stubFetchRoutes([saved]);
      render(<CreatePage />);
      await userEvent.type(screen.getByLabelText('Title *'), 'T');
      await userEvent.click(screen.getByRole('button', { name: '+ Radio' }));
      await userEvent.type(screen.getByLabelText('Question Text *'), 'Pick');
      const first = screen.getByLabelText('Choice 1');
      await userEvent.clear(first);
      await userEvent.type(first, 'Red');
      await userEvent.click(screen.getByRole('button', { name: '+ Add choice' }));
      await userEvent.type(screen.getByLabelText('Choice 2'), 'Blue');
      await userEvent.click(screen.getByRole('button', { name: '+ Add choice' }));
      await userEvent.click(screen.getByRole('button', { name: 'Remove choice 3' }));
      expect(screen.queryByLabelText('Choice 3')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove choice 1' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));

      expect(screen.getByText('radiogroup (2 choices)')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));
      await waitFor(() => expect(posted(mock)).toBeDefined());
      expect((posted(mock)?.[2] as { fields: { elements: unknown[] } }).fields.elements[0]).toMatchObject({ type: 'radiogroup', choices: ['Red', 'Blue'] });
    });

    it.each(['Checkbox', 'Dropdown'])('starts a %s question with one option', async (label) => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      await userEvent.click(screen.getByRole('button', { name: `+ ${label}` }));
      expect(screen.getByLabelText('Choice 1')).toHaveValue('Option 1');
    });

    it('requires at least one non-blank option on a choice question', async () => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      await userEvent.click(screen.getByRole('button', { name: '+ Checkbox' }));
      await userEvent.type(screen.getByLabelText('Question Text *'), 'Pick');
      await userEvent.clear(screen.getByLabelText('Choice 1'));
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));

      expect(toast.warning).toHaveBeenCalledWith('Multiple choice questions must have at least one option');
      expect(screen.getByRole('heading', { name: 'Add checkbox Question' })).toBeInTheDocument();
    });

    it('requires a question title', async () => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      await userEvent.click(screen.getByRole('button', { name: '+ Comment' }));
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));
      expect(toast.warning).toHaveBeenCalledWith('Question title is required');
    });

    it('configures a rating range, a required flag, an export label and a text input type', async () => {
      const mock = stubFetchRoutes([saved]);
      render(<CreatePage />);
      await userEvent.type(screen.getByLabelText('Title *'), 'T');

      await userEvent.click(screen.getByRole('button', { name: '+ Rating' }));
      await userEvent.type(screen.getByLabelText('Question Text *'), 'Score');
      await userEvent.clear(screen.getByLabelText('Max Value'));
      await userEvent.type(screen.getByLabelText('Max Value'), '10');
      await userEvent.clear(screen.getByLabelText('Min Value'));
      await userEvent.type(screen.getByLabelText('Min Value'), '0');
      await userEvent.click(screen.getByLabelText('Required question'));
      await userEvent.type(screen.getByLabelText('Export Label (optional)'), 'score');
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));
      expect(screen.getByText('rating (0-10)')).toBeInTheDocument();
      expect(screen.getByText('CSV: "score"')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
      await userEvent.type(screen.getByLabelText('Question Text *'), 'Email');
      await userEvent.selectOptions(screen.getByLabelText('Input Type'), 'email');
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));

      await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));
      await waitFor(() => expect(posted(mock)).toBeDefined());
      const elements = (posted(mock)?.[2] as { fields: { elements: Array<Record<string, unknown>> } }).fields.elements;
      expect(elements[0]).toMatchObject({ type: 'rating', rateMin: 0, rateMax: 10, isRequired: true, exportLabel: 'score' });
      expect(elements[1]).toMatchObject({ type: 'text', inputType: 'email' });
    });

    it('clears an emptied export label rather than saving an empty string', async () => {
      const mock = stubFetchRoutes([saved]);
      render(<CreatePage />);
      await userEvent.type(screen.getByLabelText('Title *'), 'T');
      await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
      await userEvent.type(screen.getByLabelText('Question Text *'), 'Q');
      await userEvent.type(screen.getByLabelText('Export Label (optional)'), 'x');
      await userEvent.clear(screen.getByLabelText('Export Label (optional)'));
      await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));
      await waitFor(() => expect(posted(mock)).toBeDefined());
      expect((posted(mock)?.[2] as { fields: { elements: Array<Record<string, unknown>> } }).fields.elements[0].exportLabel).toBeUndefined();
    });

    it('cancels a new question without adding it', async () => {
      stubFetchRoutes([]);
      render(<CreatePage />);
      await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Question Text *')).not.toBeInTheDocument();
      expect(screen.getByText('Questions (0)')).toBeInTheDocument();
    });

    describe('with questions in the list', () => {
      async function withThree() {
        stubFetchRoutes([saved]);
        render(<CreatePage />);
        await addQuestion('Text', 'First');
        await addQuestion('Text', 'Second');
        await addQuestion('Text', 'Third');
      }
      const titles = () => screen.getAllByText(/^(First|Second|Third|Middle)\*?$/).map((node) => node.textContent);

      it('reorders with the arrow buttons, which stop at the ends', async () => {
        await withThree();
        const rows = () => screen.getAllByRole('button', { name: 'Move up' });
        expect(rows()[0]).toBeDisabled();
        expect(screen.getAllByRole('button', { name: 'Move down' })[2]).toBeDisabled();

        await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
        expect(titles()).toEqual(['Second', 'First', 'Third']);
        await userEvent.click(screen.getAllByRole('button', { name: 'Move up' })[2]);
        expect(titles()).toEqual(['Second', 'Third', 'First']);
      });

      it('edits a question in place', async () => {
        await withThree();
        await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
        expect(screen.getByRole('heading', { name: 'Edit Question' })).toBeInTheDocument();
        const title = screen.getByLabelText('Question Text *');
        await userEvent.clear(title);
        await userEvent.type(title, 'Middle');
        await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        expect(titles()).toEqual(['First', 'Middle', 'Third']);
      });

      it('cancelling an edit leaves the question as it was', async () => {
        await withThree();
        await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        await userEvent.type(screen.getByLabelText('Question Text *'), ' changed');
        await userEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: false }));
        expect(titles()).toEqual(['First', 'Second', 'Third']);
      });

      it('deletes a question once confirmed', async () => {
        await withThree();
        vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
        await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
        expect(titles()).toEqual(['First', 'Third']);
      });

      it('keeps the question when the delete is declined', async () => {
        await withThree();
        vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
        await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
        expect(titles()).toEqual(['First', 'Second', 'Third']);
      });

      it('marks required questions', async () => {
        stubFetchRoutes([]);
        render(<CreatePage />);
        await userEvent.click(screen.getByRole('button', { name: '+ Text' }));
        await userEvent.type(screen.getByLabelText('Question Text *'), 'Must');
        await userEvent.click(screen.getByLabelText('Required question'));
        await userEvent.click(screen.getByRole('button', { name: 'Add Question' }));
        const row = screen.getByText('Must').closest('div') as HTMLElement;
        expect(within(row).getByText('*')).toBeInTheDocument();
      });
    });
  });
});

describe('/create?id= — edit survey', () => {
  const stored = {
    id: 'abc',
    title: 'Stored',
    description: 'Existing',
    status: 'published',
    type: 'pre-event',
    settings: { eventId: 'event_1' },
    fields: { pages: [{ elements: [{ type: 'text', name: 'a', title: 'First' }] }, { elements: [{ type: 'rating', name: 'b', title: 'Second' }] }] },
  };

  it('loads the survey (flattening pages) and saves changes with PUT, keeping its settings and publish state', async () => {
    setSearchParams('id=abc');
    const mock = stubFetchRoutes([
      { match: '/dykil/api/surveys/abc', body: stored },
      { method: 'PUT', match: '/dykil/api/surveys/abc', body: stored },
    ]);
    render(<CreatePage />);

    expect(await screen.findByRole('heading', { name: 'Edit Survey' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Stored');
    expect(screen.getByLabelText('Description')).toHaveValue('Existing');
    expect(screen.getByLabelText(/Ticket-holders only/)).toHaveValue('event_1');
    expect(screen.getByText('Questions (2)')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Title *'), ' v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save as Draft' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/dashboard'));
    expect(posted(mock)).toEqual([
      'PUT',
      '/dykil/api/surveys/abc',
      expect.objectContaining({ title: 'Stored v2', status: 'published', type: 'pre-event', settings: { eventId: 'event_1' } }),
    ]);
  });

  it('goes back to the dashboard when the survey cannot be loaded', async () => {
    setSearchParams('id=abc');
    stubFetchRoutes([{ match: '/dykil/api/surveys/abc', status: 404, body: { error: 'Survey not found' } }]);
    render(<CreatePage />);
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/dashboard'));
    expect(toast.error).toHaveBeenCalledWith('Failed to load survey');
  });
});
