import type { SurveyJSElement } from '@/lib/survey';

/** A question as the builder edits it — the SurveyJS element plus the typed options the builder owns. */
export interface QuestionElement extends SurveyJSElement {
  choices?: Array<string | { value?: string; text?: string }>;
  rateMin?: number;
  rateMax?: number;
  inputType?: string;
  exportLabel?: string;
}

export type QuestionType = 'text' | 'comment' | 'radiogroup' | 'checkbox' | 'dropdown' | 'rating' | 'boolean';

/** The "+ Add" palette, in display order. */
export const QUESTION_TYPES: ReadonlyArray<{ type: QuestionType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'comment', label: 'Comment' },
  { type: 'radiogroup', label: 'Radio' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'rating', label: 'Rating' },
  { type: 'boolean', label: 'Yes/No' },
];

export const CHOICE_TYPES: ReadonlySet<string> = new Set(['radiogroup', 'checkbox', 'dropdown']);

/** Type-specific defaults for a new question. */
const TYPE_DEFAULTS: Partial<Record<QuestionType, Partial<QuestionElement>>> = {
  radiogroup: { choices: ['Option 1'] },
  checkbox: { choices: ['Option 1'] },
  dropdown: { choices: ['Option 1'] },
  rating: { rateMin: 1, rateMax: 5 },
};

export function newQuestion(type: QuestionType, nowMs: number = Date.now()): QuestionElement {
  return { type, name: `q${nowMs}`, title: '', isRequired: false, ...TYPE_DEFAULTS[type] };
}

export function choiceText(choice: string | { value?: string; text?: string }): string {
  return typeof choice === 'string' ? choice : (choice.text ?? '');
}

/** The first problem with a question being saved, or null when it is valid. */
export function validateQuestion(question: QuestionElement): string | null {
  if (!question.title.trim()) return 'Question title is required';
  if (CHOICE_TYPES.has(question.type) && !(question.choices ?? []).some((choice) => choiceText(choice).trim())) {
    return 'Multiple choice questions must have at least one option';
  }
  return null;
}

/** The first problem with a survey being saved, or null when it is valid. */
export function validateSurveyDraft(draft: { title: string; elements: readonly unknown[] }): string | null {
  if (!draft.title.trim()) return 'Survey title is required';
  if (draft.elements.length === 0) return 'Survey must have at least one question';
  return null;
}

/** Append (`index` null) or replace the question at `index`. */
export function upsertQuestion(list: readonly QuestionElement[], question: QuestionElement, index: number | null): QuestionElement[] {
  if (index === null) return [...list, question];
  return list.map((existing, i) => (i === index ? question : existing));
}

export function removeQuestion(list: readonly QuestionElement[], index: number): QuestionElement[] {
  return list.filter((_, i) => i !== index);
}

/** Swap a question with its neighbour; out-of-range moves return the list unchanged. */
export function moveQuestion(list: readonly QuestionElement[], index: number, direction: 'up' | 'down'): QuestionElement[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** One-line summary under a question's title in the builder list. */
export function describeQuestion(question: QuestionElement): string {
  if (CHOICE_TYPES.has(question.type)) return `${question.type} (${question.choices?.length ?? 0} choices)`;
  if (question.type === 'rating') return `rating (${question.rateMin ?? 1}-${question.rateMax ?? 5})`;
  return question.type;
}
