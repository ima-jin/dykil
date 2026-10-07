// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import { answerWith } from '@/test/helpers/survey-form-mock';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { journeyRoutes, PUBLISHED_SURVEY, type Journey } from '@/test/helpers/survey-journey';

import { SurveyRunner, type RunnerVariant } from '../SurveyRunner';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  answerWith({ q1: 'yes' });
});

function mount(journey: Journey = {}, props: { variant?: RunnerVariant; ticketId?: string | null; onCompleted?: (a: Record<string, unknown>) => void } = {}) {
  const mock = stubFetchRoutes(journeyRoutes(journey));
  render(<SurveyRunner surveyId="s1" variant={props.variant ?? 'page'} ticketId={props.ticketId} onCompleted={props.onCompleted} />);
  return mock;
}

const api = (mock: ReturnType<typeof stubFetchRoutes>) => callLog(mock).filter(([method]) => method === 'POST');

describe.each<RunnerVariant>(['page', 'embed'])('SurveyRunner (%s)', (variant) => {
  describe('screens that stop the respondent', () => {
    it.each<[string, Journey, string]>([
      ['an unknown survey', { survey: { status: 404, body: { error: 'Survey not found' } } }, 'Survey not found'],
      ['a draft survey', { survey: { body: { ...PUBLISHED_SURVEY, status: 'draft' } } }, 'This survey is currently draft.'],
      ['a closed survey', { survey: { body: { ...PUBLISHED_SURVEY, status: 'closed' } } }, 'This survey is currently closed.'],
      ['a survey that fails to load', { survey: { status: 500, body: { error: 'Media is down' } } }, 'Media is down'],
      ['an unavailable ticket gate', { gate: { status: 502, body: { error: 'The ticket gate is unavailable' } } }, 'The ticket gate is unavailable'],
      ['an unconfigured ticket gate', { gate: { status: 501, body: { error: 'The ticket gate is not configured' } } }, 'The ticket gate is not configured'],
    ])('explains %s', async (_label, journey, message) => {
      mount(journey, { variant });
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByTestId('survey-form')).not.toBeInTheDocument();
    });

    it('blocks a signed-in non-holder of a ticket-gated survey', async () => {
      mount({ gate: { body: { gated: true, allowed: false } } }, { variant });
      expect(await screen.findByText('A ticket is required')).toBeInTheDocument();
      expect(screen.queryByTestId('survey-form')).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in instead of showing the form', async () => {
      const mock = mount({ signedIn: false }, { variant });
      const link = await screen.findByRole('link', { name: 'Sign in with Imajin' });
      expect(link.getAttribute('href')).toContain('/auth/login?next=');
      expect(screen.getByText('Event feedback')).toBeInTheDocument();
      expect(screen.queryByTestId('survey-form')).not.toBeInTheDocument();
      expect(callLog(mock).some(([, path]) => path.endsWith('/gate'))).toBe(false);
    });
  });

  it('admits a ticket holder to a gated survey', async () => {
    mount({ gate: { body: { gated: true, allowed: true } } }, { variant });
    expect(await screen.findByTestId('survey-form')).toBeInTheDocument();
  });

  it('shows the survey title and description above the questions', async () => {
    mount({}, { variant });
    expect(await screen.findByRole('heading', { name: 'Event feedback' })).toBeInTheDocument();
    expect(screen.getByText('Tell us how it went')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('survey-form').dataset.json as string)).toEqual({ elements: PUBLISHED_SURVEY.fields.elements });
  });

  it('says so when a published survey has no questions', async () => {
    mount({ survey: { body: { ...PUBLISHED_SURVEY, description: null, fields: { elements: [] } } } }, { variant });
    expect(await screen.findByText('This survey has no questions yet.')).toBeInTheDocument();
  });

  describe('answer → sign → submit', () => {
    it('relays the respondent’s own signature; the app never signs', async () => {
      const onCompleted = vi.fn();
      const mock = mount({}, { variant, onCompleted });

      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      expect(await screen.findByRole('heading', { name: 'Sign your response' })).toBeInTheDocument();
      expect(screen.getByLabelText('Payload to sign')).toHaveValue('{"canonical":"payload"}');

      await userEvent.type(screen.getByLabelText('Signature (hex)'), '  abc123  ');
      await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));

      expect(await screen.findByText('Response submitted')).toBeInTheDocument();
      expect(api(mock)).toEqual([
        ['POST', '/dykil/api/surveys/s1/respond/prepare', { answers: { q1: 'yes' } }],
        ['POST', '/dykil/api/surveys/s1/respond', { answers: { q1: 'yes' }, issuedAt: 1700, signature: 'abc123' }],
      ]);
      expect(onCompleted).toHaveBeenCalledWith({ q1: 'yes' });
    });

    it('scopes the response to the ticket in an events-page embed', async () => {
      const mock = mount({}, { variant, ticketId: 'tkt_9' });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      await userEvent.type(await screen.findByLabelText('Signature (hex)'), 'ab');
      await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));
      await screen.findByText('Response submitted');

      expect(api(mock).map(([, , body]) => body)).toEqual([
        { answers: { q1: 'yes' }, ticketId: 'tkt_9' },
        { answers: { q1: 'yes' }, ticketId: 'tkt_9', issuedAt: 1700, signature: 'ab' },
      ]);
      expect(callLog(mock).find(([, path]) => path.includes('/responses/check'))?.[1]).toContain('ticketId=tkt_9');
    });

    it('disables submit until a signature is entered', async () => {
      mount({}, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      expect(await screen.findByRole('button', { name: 'Submit signed response' })).toBeDisabled();
    });

    it('copies the payload to sign', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      mount({}, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Copy payload' }));
      expect(writeText).toHaveBeenCalledWith('{"canonical":"payload"}');
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('returns to the form with the answers kept when the respondent goes back', async () => {
      mount({}, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Back to answers' }));
      expect(await screen.findByTestId('survey-form')).toHaveAttribute('data-initial', '{"q1":"yes"}');
    });

    it('keeps the answers and shows the reason when the payload cannot be prepared', async () => {
      mount({ prepare: { status: 400, body: { error: 'Field "How was it?" is required' } } }, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Field "How was it?" is required');
      expect(screen.getByTestId('survey-form')).toHaveAttribute('data-initial', '{"q1":"yes"}');
    });

    it('stays on the signing step with the kernel’s reason when the signature is refused', async () => {
      const onCompleted = vi.fn();
      mount({ respond: { status: 400, body: { error: 'Invalid signature' } } }, { variant, onCompleted });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      await userEvent.type(await screen.findByLabelText('Signature (hex)'), 'bad');
      await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid signature');
      expect(screen.getByRole('button', { name: 'Submit signed response' })).toBeEnabled();
      expect(onCompleted).not.toHaveBeenCalled();
    });

    it('reports a ticket-gate refusal at submit time', async () => {
      mount({ respond: { status: 403, body: { error: 'A ticket for this event is required to respond' } } }, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
      await userEvent.type(await screen.findByLabelText('Signature (hex)'), 'ab');
      await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('A ticket for this event is required to respond');
    });
  });

  describe('an earlier response', () => {
    const earlier: Journey = { existing: { body: { completed: true, responseId: 'r-old', answers: { q1: 'before' } } } };

    it('shows the survey as already answered and tells the embed parent', async () => {
      const onCompleted = vi.fn();
      mount(earlier, { variant, onCompleted });
      expect(await screen.findByText('Response submitted')).toBeInTheDocument();
      expect(screen.queryByTestId('survey-form')).not.toBeInTheDocument();
      expect(onCompleted).toHaveBeenCalledWith({ q1: 'before' });
    });

    it('edits by superseding the earlier response, inside the signed payload request', async () => {
      const mock = mount(earlier, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit answers' }));

      expect(await screen.findByText('Editing your response')).toBeInTheDocument();
      expect(screen.getByTestId('survey-form')).toHaveAttribute('data-initial', '{"q1":"before"}');

      answerWith({ q1: 'after' });
      await userEvent.click(screen.getByRole('button', { name: 'Complete survey' }));
      await userEvent.type(await screen.findByLabelText('Signature (hex)'), 'ab');
      await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));
      await screen.findByText('Response submitted');

      expect(api(mock).map(([, , body]) => body)).toEqual([
        { answers: { q1: 'after' }, supersedes: 'r-old' },
        { answers: { q1: 'after' }, supersedes: 'r-old', issuedAt: 1700, signature: 'ab' },
      ]);
    });

    it('cancelling an edit returns to the recorded response and sends nothing', async () => {
      const mock = mount(earlier, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit answers' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Response submitted')).toBeInTheDocument();
      expect(api(mock)).toEqual([]);
    });

    it('edits an earlier response that has no id without sending a supersedes', async () => {
      const mock = mount({ existing: { body: { completed: true, answers: { q1: 'before' } } } }, { variant });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit answers' }));
      await userEvent.click(screen.getByRole('button', { name: 'Complete survey' }));
      await screen.findByLabelText('Signature (hex)');
      expect(api(mock)[0][2]).toEqual({ answers: { q1: 'yes' } });
    });
  });

  it('treats a failed earlier-response lookup as "no earlier response"', async () => {
    mount({ existing: { status: 500, body: {} } }, { variant });
    expect(await screen.findByTestId('survey-form')).toBeInTheDocument();
  });

  it('ignores a late response after the host unmounts', async () => {
    const mock = stubFetchRoutes(journeyRoutes());
    const { unmount } = render(<SurveyRunner surveyId="s1" variant={variant} />);
    unmount();
    await waitFor(() => expect(mock).toHaveBeenCalled());
  });
});

describe('page vs embed chrome', () => {
  it('the page variant links back home from a dead end; the embed does not', async () => {
    mount({ survey: { status: 404, body: {} } }, { variant: 'page' });
    expect(await screen.findByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    cleanup();

    mount({ survey: { status: 404, body: {} } }, { variant: 'embed' });
    await screen.findByText('Survey not found');
    expect(screen.queryByRole('link', { name: 'Back to Home' })).not.toBeInTheDocument();
  });

  it('after submitting, the page offers Back to Home; the embed does not', async () => {
    const earlier = { existing: { body: { completed: true, answers: { q1: 'a' } } } };
    mount(earlier, { variant: 'page' });
    expect(await screen.findByRole('link', { name: 'Back to Home' })).toBeInTheDocument();
    cleanup();

    mount(earlier, { variant: 'embed' });
    await screen.findByText('Response submitted');
    expect(screen.queryByRole('link', { name: 'Back to Home' })).not.toBeInTheDocument();
  });

  it('the embed signs in at the top window so the login is not trapped in the iframe', async () => {
    mount({ signedIn: false }, { variant: 'embed' });
    expect(await screen.findByRole('link', { name: 'Sign in with Imajin' })).toHaveAttribute('target', '_top');
  });
});
