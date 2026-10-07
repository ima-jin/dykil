// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyForm } from '../SurveyForm';

// SurveyJS observes element sizes; jsdom has no ResizeObserver.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = {
  elements: [
    { type: 'text', name: 'name', title: 'Your name' },
    { type: 'boolean', name: 'ok', title: 'Fine?' },
  ],
};

describe('SurveyForm (real SurveyJS)', () => {
  it('renders the questions and hands the completed answers to onComplete', async () => {
    const onComplete = vi.fn();
    render(<SurveyForm json={json} onComplete={onComplete} />);

    await userEvent.type(screen.getByRole('textbox'), 'Ann');
    await userEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toMatchObject({ name: 'Ann' });
  });

  it('pre-fills initial answers', () => {
    render(<SurveyForm json={json} initialAnswers={{ name: 'Before' }} onComplete={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('Before');
  });

  it('renders a question title through the HTML allowlist: formatting survives, scripts and handlers do not', () => {
    const { container } = render(
      <SurveyForm
        json={{ elements: [{ type: 'text', name: 'q', title: 'Rate <b>us</b><script>alert(1)</script> <a href="javascript:x" onclick="y()">link</a>' }] }}
        onComplete={vi.fn()}
      />,
    );
    expect(container.querySelector('b')?.textContent).toBe('us');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('in preview mode shows the questions but no Complete button, and tolerates the default no-op', () => {
    render(<SurveyForm json={json} preview />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
  });

  it('stops reporting completion once unmounted', async () => {
    const onComplete = vi.fn();
    const { unmount } = render(<SurveyForm json={json} onComplete={onComplete} />);
    unmount();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
