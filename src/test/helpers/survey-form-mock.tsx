import { vi } from 'vitest';

/**
 * SurveyJS is exercised on its own in SurveyForm.test.tsx; everything that
 * merely hosts it uses this stand-in, which exposes what the host passed
 * (`initialAnswers`, `preview`) and a button that "completes" the survey with
 * whatever `answerWith(...)` set.
 */
let completionAnswers: Record<string, unknown> = { q1: 'yes' };

export function answerWith(answers: Record<string, unknown>): void {
  completionAnswers = answers;
}

vi.mock('@/components/SurveyForm', () => ({
  SurveyForm: ({
    json,
    initialAnswers,
    preview,
    onComplete,
  }: {
    json: unknown;
    initialAnswers?: unknown;
    preview?: boolean;
    onComplete?: (answers: Record<string, unknown>) => void;
  }) => (
    <div data-testid="survey-form" data-preview={String(Boolean(preview))} data-initial={JSON.stringify(initialAnswers ?? null)} data-json={JSON.stringify(json)}>
      <button type="button" onClick={() => onComplete?.(completionAnswers)}>
        Complete survey
      </button>
    </div>
  ),
}));
