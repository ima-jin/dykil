import { describe, expect, it } from 'vitest';
import {
  choiceText,
  describeQuestion,
  moveQuestion,
  newQuestion,
  QUESTION_TYPES,
  removeQuestion,
  upsertQuestion,
  validateQuestion,
  validateSurveyDraft,
  type QuestionElement,
} from '../survey-builder';

const q = (name: string, extra: Partial<QuestionElement> = {}): QuestionElement => ({ type: 'text', name, title: name, ...extra });

describe('newQuestion', () => {
  it.each(QUESTION_TYPES.map(({ type }) => [type]))('creates an empty %s question named from the clock', (type) => {
    const question = newQuestion(type, 1234);
    expect(question).toMatchObject({ type, name: 'q1234', title: '', isRequired: false });
  });

  it.each([
    ['radiogroup', { choices: ['Option 1'] }],
    ['checkbox', { choices: ['Option 1'] }],
    ['dropdown', { choices: ['Option 1'] }],
    ['rating', { rateMin: 1, rateMax: 5 }],
  ] as const)('gives %s its defaults', (type, defaults) => {
    expect(newQuestion(type, 1)).toMatchObject(defaults);
  });

  it('gives text and boolean no extra options', () => {
    expect(Object.keys(newQuestion('boolean', 1)).sort()).toEqual(['isRequired', 'name', 'title', 'type']);
  });
});

describe('validateQuestion', () => {
  it.each([
    ['a blank title', q('a', { title: '  ' }), 'Question title is required'],
    ['a choice question with no choices', q('a', { type: 'radiogroup', choices: [] }), 'Multiple choice questions must have at least one option'],
    ['a choice question with only blank choices', q('a', { type: 'checkbox', choices: ['', ' '] }), 'Multiple choice questions must have at least one option'],
    ['a choice question with no choices key', q('a', { type: 'dropdown' }), 'Multiple choice questions must have at least one option'],
    ['a valid text question', q('a'), null],
    ['a valid choice question', q('a', { type: 'radiogroup', choices: ['x'] }), null],
    ['object choices with text', q('a', { type: 'radiogroup', choices: [{ value: '1', text: 'One' }] }), null],
  ])('%s', (_label, question, expected) => {
    expect(validateQuestion(question)).toBe(expected);
  });
});

describe('validateSurveyDraft', () => {
  it.each([
    [{ title: ' ', elements: [q('a')] }, 'Survey title is required'],
    [{ title: 'T', elements: [] }, 'Survey must have at least one question'],
    [{ title: 'T', elements: [q('a')] }, null],
  ])('%j', (draft, expected) => {
    expect(validateSurveyDraft(draft)).toBe(expected);
  });
});

describe('list operations', () => {
  const list = [q('a'), q('b'), q('c')];
  const names = (items: QuestionElement[]) => items.map((item) => item.name);

  it.each([
    ['appends when the index is null', null, ['a', 'b', 'c', 'n']],
    ['replaces at an index', 1, ['a', 'n', 'c']],
  ])('upsertQuestion %s', (_label, index, expected) => {
    expect(names(upsertQuestion(list, q('n'), index))).toEqual(expected);
  });

  it('removeQuestion drops one', () => {
    expect(names(removeQuestion(list, 0))).toEqual(['b', 'c']);
  });

  it.each([
    [1, 'up', ['b', 'a', 'c']],
    [1, 'down', ['a', 'c', 'b']],
    [0, 'up', ['a', 'b', 'c']],
    [2, 'down', ['a', 'b', 'c']],
  ] as const)('moveQuestion(%i, %s)', (index, direction, expected) => {
    expect(names(moveQuestion(list, index, direction))).toEqual(expected);
  });

  it('never mutates its input', () => {
    moveQuestion(list, 0, 'down');
    expect(names(list)).toEqual(['a', 'b', 'c']);
  });
});

describe('choiceText / describeQuestion', () => {
  it.each([
    ['a string', 'Yes', 'Yes'],
    ['an object with text', { text: 'One' }, 'One'],
    ['an object without text', { value: '1' }, ''],
  ])('choiceText of %s', (_label, choice, expected) => {
    expect(choiceText(choice)).toBe(expected);
  });

  it.each([
    [q('a', { type: 'radiogroup', choices: ['x', 'y'] }), 'radiogroup (2 choices)'],
    [q('a', { type: 'dropdown' }), 'dropdown (0 choices)'],
    [q('a', { type: 'rating', rateMin: 2, rateMax: 9 }), 'rating (2-9)'],
    [q('a', { type: 'rating' }), 'rating (1-5)'],
    [q('a', { type: 'comment' }), 'comment'],
  ])('describes %j', (question, expected) => {
    expect(describeQuestion(question)).toBe(expected);
  });
});
