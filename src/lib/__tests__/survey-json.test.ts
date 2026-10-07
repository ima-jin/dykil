import { describe, expect, it } from 'vitest';
import { buildSurveyJson, flattenElements } from '../survey-json';

const q = (name: string) => ({ type: 'text', name, title: name });

describe('flattenElements', () => {
  it.each([
    ['a { elements } document', { elements: [q('a'), q('b')] }, ['a', 'b']],
    ['a legacy bare array', [q('a')], ['a']],
    ['a multi-page document', { pages: [{ elements: [q('a')] }, { elements: [q('b'), q('c')] }] }, ['a', 'b', 'c']],
    ['pages win over top-level elements', { pages: [{ elements: [q('p')] }], elements: [q('e')] }, ['p']],
    ['null elements and pages without elements', { pages: [null, { name: 'empty' }, { elements: [null, q('a')] }] }, ['a']],
    ['null entries in a bare array', [null, q('a')], ['a']],
    ['null entries in top-level elements', { elements: [null, q('a')] }, ['a']],
    ['an object with neither', { title: 'x' }, []],
    ['null', null, []],
    ['a string', 'nope', []],
  ])('flattens %s', (_label, fields, names) => {
    expect(flattenElements(fields).map((element) => element.name)).toEqual(names);
  });
});

describe('buildSurveyJson', () => {
  it.each([
    ['empty elements', { elements: [] }],
    ['no recognisable shape', { title: 'x' }],
    ['only empty pages', { pages: [{ elements: [] }, null] }],
    ['an empty array', []],
    ['null', null],
  ])('returns null for %s', (_label, fields) => {
    expect(buildSurveyJson(fields)).toBeNull();
  });

  it('wraps a bare array as { elements }', () => {
    expect(buildSurveyJson([q('a')])).toEqual({ elements: [q('a')] });
  });

  it('keeps extra SurveyJS settings and strips null elements', () => {
    expect(buildSurveyJson({ showQuestionNumbers: 'off', elements: [null, q('a')] })).toEqual({
      showQuestionNumbers: 'off',
      elements: [q('a')],
    });
  });

  it('drops empty pages from a multi-page document and keeps the rest', () => {
    const json = buildSurveyJson({ title: 't', pages: [null, { name: 'p1', elements: [q('a'), null] }, { name: 'p2', elements: [] }] });
    expect(json).toEqual({ title: 't', pages: [{ name: 'p1', elements: [q('a')] }] });
  });
});
