// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigationMock, setSearchParams } from '@/test/helpers/next-navigation-mock';
import '@/test/helpers/ui-mock';
import { answerWith } from '@/test/helpers/survey-form-mock';
import { callLog, stubFetchRoutes } from '@/test/helpers/fetch-mock';
import { journeyRoutes } from '@/test/helpers/survey-journey';

import EmbedPage from '../page';

const observers: Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];

beforeEach(() => {
  resetNavigationMock();
  observers.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: () => void) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  answerWith({ q1: 'yes' });
});

const mount = async (surveyId = 's1') => render(await EmbedPage({ params: Promise.resolve({ surveyId }) }));
const messages = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(([message, origin]) => [message, origin]);

describe('/embed/[surveyId]', () => {
  it('renders the survey with no navigation or footer', async () => {
    setSearchParams('parentOrigin=https://events.example');
    stubFetchRoutes(journeyRoutes());
    await mount();

    expect(await screen.findByRole('heading', { name: 'Event feedback' })).toBeInTheDocument();
    expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('imajin-footer')).not.toBeInTheDocument();
  });

  it('reports its height to the parent origin it was given, and again when it resizes', async () => {
    setSearchParams('parentOrigin=https://events.example');
    stubFetchRoutes(journeyRoutes());
    const post = vi.spyOn(globalThis.parent, 'postMessage').mockImplementation(() => undefined);
    await mount();
    await screen.findByTestId('survey-form');

    expect(messages(post)[0]).toEqual([{ type: 'survey-height', height: 0 }, 'https://events.example']);
    const before = post.mock.calls.length;
    observers[0].callback();
    expect(post.mock.calls).toHaveLength(before + 1);
  });

  it('stops observing when it is removed', async () => {
    setSearchParams('parentOrigin=https://events.example');
    stubFetchRoutes(journeyRoutes());
    const { unmount } = await mount();
    await screen.findByTestId('survey-form');
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('never posts to an unknown parent (no parentOrigin and no referrer)', async () => {
    stubFetchRoutes(journeyRoutes());
    const post = vi.spyOn(globalThis.parent, 'postMessage').mockImplementation(() => undefined);
    await mount();
    await screen.findByTestId('survey-form');
    expect(post).not.toHaveBeenCalled();
  });

  it('falls back to the referrer’s origin', async () => {
    stubFetchRoutes(journeyRoutes());
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://dev-jin.imajin.ai/events/e/1');
    const post = vi.spyOn(globalThis.parent, 'postMessage').mockImplementation(() => undefined);
    await mount();
    await screen.findByTestId('survey-form');
    expect(messages(post)[0][1]).toBe('https://dev-jin.imajin.ai');
  });

  it('tells the parent when the survey is completed — after the response is recorded — with the answers', async () => {
    setSearchParams('parentOrigin=https://events.example&ticketId=tkt_1');
    const mock = stubFetchRoutes(journeyRoutes());
    const post = vi.spyOn(globalThis.parent, 'postMessage').mockImplementation(() => undefined);
    await mount();

    await userEvent.click(await screen.findByRole('button', { name: 'Complete survey' }));
    expect(messages(post).some(([message]) => (message as { type: string }).type === 'survey-completed')).toBe(false);
    await userEvent.type(await screen.findByLabelText('Signature (hex)'), 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Submit signed response' }));

    await waitFor(() =>
      expect(messages(post)).toContainEqual([{ type: 'survey-completed', surveyId: 's1', answers: { q1: 'yes' } }, 'https://events.example']),
    );
    expect(callLog(mock).find(([, path]) => path.includes('/respond/prepare'))?.[2]).toMatchObject({ ticketId: 'tkt_1' });
  });

  it('tells the parent straight away when the respondent already completed it', async () => {
    setSearchParams('parentOrigin=https://events.example');
    stubFetchRoutes(journeyRoutes({ existing: { body: { completed: true, responseId: 'r1', answers: { q1: 'before' } } } }));
    const post = vi.spyOn(globalThis.parent, 'postMessage').mockImplementation(() => undefined);
    await mount();
    await screen.findByText('Response submitted');
    expect(messages(post)).toContainEqual([{ type: 'survey-completed', surveyId: 's1', answers: { q1: 'before' } }, 'https://events.example']);
  });

  it('decodes an encoded survey id', async () => {
    const mock = stubFetchRoutes([
      { match: '/dykil/api/session', body: { did: 'did:imajin:me' } },
      { match: '/dykil/api/surveys/a%20b', status: 404, body: {} },
    ]);
    await mount('a%20b');
    await screen.findByText('Survey not found');
    expect(callLog(mock).map(([, path]) => path)).toContain('/dykil/api/surveys/a%20b');
  });
});
