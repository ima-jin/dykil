import { describe, expect, it } from 'vitest';
import type { SurveyJSElement } from '../survey';
import { aggregateResponses, answersOf, barEntries, buildCsv, csvFilename, formatAnswer, type ResponseRow } from '../results';

const field = (type: string, name: string, extra: Record<string, unknown> = {}): SurveyJSElement => ({ type, name, title: `Title ${name}`, ...extra });
const row = (id: string, answers: Record<string, unknown> | null, provenance?: string): ResponseRow => ({
  id,
  issuerDid: `did:imajin:${id}`,
  issuedAt: '2026-01-02T03:04:05.000Z',
  payload: answers === null ? null : { answers, provenance },
});

describe('answersOf', () => {
  it.each([
    [row('a', { q: 1 }), { q: 1 }],
    [row('b', null), {}],
    [{ ...row('c', {}), payload: {} }, {}],
  ])('reads the answers of %j', (input, expected) => {
    expect(answersOf(input)).toEqual(expected);
  });
});

describe('aggregateResponses', () => {
  const elements = [
    field('radiogroup', 'color'),
    field('checkbox', 'langs'),
    field('rating', 'stars', { rateMax: 5 }),
    field('boolean', 'ok'),
    field('text', 'note'),
    field('comment', 'long'),
    field('text', 'mail', { inputType: 'email' }),
    field('dropdown', 'size'),
    field('file', 'other'),
  ];
  const rows = [
    row('r1', { color: 'red', langs: ['ts', 'go'], stars: 4, ok: true, note: 'hi', long: 'a\nb', mail: 'a@b.c', size: 'L', other: 'x' }),
    row('r2', { color: 'red', langs: 'ts', stars: '2', ok: false, note: '', size: 'M' }),
    row('r3', { color: 'blue', stars: 0, ok: true }),
    row('r4', null),
  ];
  const result = aggregateResponses(elements, rows);

  it('counts single-choice answers', () => {
    expect(result.color).toMatchObject({ total: 3, values: { red: 2, blue: 1 } });
    expect(result.size.values).toEqual({ L: 1, M: 1 });
  });

  it('counts each checkbox selection, whether the answer is an array or a single value', () => {
    expect(result.langs.values).toEqual({ ts: 2, go: 1 });
    expect(result.langs.total).toBe(2);
  });

  it('averages ratings, treating 0 as an answer and string numbers as numbers', () => {
    expect(result.stars.total).toBe(3);
    expect(result.stars.values).toEqual({ '4': 1, '2': 1, '0': 1 });
    expect(result.stars.average).toBe(2);
  });

  it('reports a rating average of 0 when nobody answered', () => {
    expect(aggregateResponses([field('rating', 's')], [row('x', {})]).s.average).toBe(0);
  });

  it('counts booleans, including false', () => {
    expect(result.ok.values).toEqual({ true: 2, false: 1 });
  });

  it('collects free text keyed by response, skipping empty strings; email inputs count as text', () => {
    expect(result.note.texts).toEqual([{ responseId: 'r1', text: 'hi' }]);
    expect(result.long.texts).toEqual([{ responseId: 'r1', text: 'a\nb' }]);
    expect(result.mail.texts).toEqual([{ responseId: 'r1', text: 'a@b.c' }]);
  });

  it('counts an unsupported question type as answered but tallies nothing', () => {
    expect(result.other).toMatchObject({ total: 1, values: {}, texts: [] });
  });

  it('has an entry for every question even with no responses', () => {
    expect(Object.keys(aggregateResponses(elements, []))).toHaveLength(elements.length);
  });
});

describe('barEntries', () => {
  const aggregate = (type: string, values: Record<string, number>) => ({ field: field(type, 'f'), total: 9, values, texts: [] });

  it.each([
    ['choices, most chosen first', 'radiogroup', { a: 1, b: 3, c: 2 }, ['b', 'c', 'a']],
    ['ratings ascending', 'rating', { '5': 1, '1': 2, '3': 1 }, ['1', '3', '5']],
    ['booleans as a fixed Yes / No', 'boolean', { false: 4 }, ['Yes', 'No']],
  ])('orders %s', (_label, type, values, labels) => {
    expect(barEntries(aggregate(type, values)).map((entry) => entry.label)).toEqual(labels);
  });

  it('fills missing boolean sides with 0', () => {
    expect(barEntries(aggregate('boolean', { false: 4 }))).toEqual([
      { label: 'Yes', count: 0 },
      { label: 'No', count: 4 },
    ]);
  });
});

describe('formatAnswer', () => {
  it.each([
    [field('text', 'a'), undefined, ''],
    [field('text', 'a'), null, ''],
    [field('text', 'a'), '', ''],
    [field('boolean', 'a'), true, 'Yes'],
    [field('boolean', 'a'), false, 'No'],
    [field('checkbox', 'a'), ['x', 'y'], 'x, y'],
    [field('rating', 'a'), 4, '4'],
    [field('text', 'a'), 'hello', 'hello'],
  ])('%j / %j', (element, answer, expected) => {
    expect(formatAnswer(element, answer)).toBe(expected);
  });
});

describe('buildCsv', () => {
  const elements = [field('text', 'a'), field('checkbox', 'b', { exportLabel: 'Langs' })];

  it('writes a header (export label wins over title), then one quoted row per response', () => {
    const csv = buildCsv(elements, [row('r1', { a: 'say "hi"', b: ['x', 'y'] })]);
    expect(csv.split('\n')).toEqual([
      '"Response ID","Submitted At","Title a","Langs"',
      '"r1","2026-01-02T03:04:05.000Z","say ""hi""","x; y"',
    ]);
  });

  it.each(['=SUM(1)', '+1', '-1', '@x', '\tx'])('neutralises a spreadsheet formula starting %j', (value) => {
    const [, dataRow] = buildCsv([field('text', 'a')], [row('r', { a: value })]).split('\n');
    expect(dataRow).toContain(`"'${value}"`);
  });

  it('writes just the header when there are no responses', () => {
    expect(buildCsv(elements, [])).toBe('"Response ID","Submitted At","Title a","Langs"');
  });
});

describe('csvFilename', () => {
  it.each([
    ['Feedback 2026!', 'Feedback_2026__results.csv'],
    ['plain', 'plain_results.csv'],
  ])('%s', (title, expected) => {
    expect(csvFilename(title)).toBe(expected);
  });
});
