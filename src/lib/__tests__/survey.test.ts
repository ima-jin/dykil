import { describe, expect, it } from 'vitest';
import {
  computeDocHash,
  findMissingRequiredField,
  isSurveyDoc,
  normalizeSurveyFields,
  normalizeSurveySettings,
  SURVEY_DOC_SCHEMA,
  surveyFilename,
  type SurveyDoc,
} from '../survey';

describe('normalizeSurveyFields', () => {
  it('accepts SurveyJS format and validates each element', () => {
    const result = normalizeSurveyFields({
      elements: [{ name: 'q1', type: 'text', title: 'Q1' }],
    });
    expect(result).toEqual({ fields: { elements: [{ name: 'q1', type: 'text', title: 'Q1' }] } });
  });

  it('rejects a SurveyJS element missing required keys', () => {
    const result = normalizeSurveyFields({ elements: [{ name: 'q1' }] });
    expect(result).toEqual({ error: 'Each field must have name, type, and title' });
  });

  it('rejects an empty elements array', () => {
    expect(normalizeSurveyFields({ elements: [] })).toEqual({ error: 'fields.elements array is required' });
  });

  it('wraps a legacy bare array into SurveyJS shape', () => {
    const legacy = [{ id: 'f1', type: 'text', label: 'Name', required: true }];
    expect(normalizeSurveyFields(legacy)).toEqual({ fields: { elements: legacy } });
  });

  it('rejects an empty legacy array', () => {
    expect(normalizeSurveyFields([])).toEqual({ error: 'fields array is required' });
  });

  it('rejects a non-object, non-array value', () => {
    expect(normalizeSurveyFields('nope')).toEqual({ error: 'fields must be an array or SurveyJS schema' });
  });
});

describe('findMissingRequiredField', () => {
  it('flags a missing required field', () => {
    const fields = { elements: [{ name: 'q1', type: 'text', title: 'Question 1', isRequired: true }] };
    expect(findMissingRequiredField(fields, {})).toBe('Field "Question 1" is required');
  });

  it('passes when all required fields are answered', () => {
    const fields = { elements: [{ name: 'q1', type: 'text', title: 'Question 1', isRequired: true }] };
    expect(findMissingRequiredField(fields, { q1: 'yes' })).toBeNull();
  });

  it('skips a conditionally-visible required field whose condition is not met', () => {
    const fields = {
      elements: [
        { name: 'dietary', type: 'radiogroup', title: 'Dietary' },
        { name: 'other', type: 'text', title: 'Other', isRequired: true, visibleIf: '{dietary} = "Other"' },
      ],
    };
    expect(findMissingRequiredField(fields, { dietary: 'None' })).toBeNull();
  });

  it('requires a conditionally-visible field once its condition is met', () => {
    const fields = {
      elements: [
        { name: 'dietary', type: 'radiogroup', title: 'Dietary' },
        { name: 'other', type: 'text', title: 'Other', isRequired: true, visibleIf: '{dietary} = "Other"' },
      ],
    };
    expect(findMissingRequiredField(fields, { dietary: 'Other' })).toBe('Field "Other" is required');
  });
});

describe('computeDocHash / isSurveyDoc / surveyFilename', () => {
  const doc: SurveyDoc = {
    schema: SURVEY_DOC_SCHEMA,
    ownerDid: 'did:imajin:owner',
    title: 'A survey',
    description: null,
    fields: { elements: [] },
    settings: {},
    type: 'survey',
    status: 'published',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('produces a deterministic sha256 hash for the same document', () => {
    const hash1 = computeDocHash(doc);
    const hash2 = computeDocHash({ ...doc });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces a different hash when the document changes', () => {
    expect(computeDocHash(doc)).not.toBe(computeDocHash({ ...doc, title: 'Different' }));
  });

  it('recognizes a valid survey doc and rejects everything else', () => {
    expect(isSurveyDoc(doc)).toBe(true);
    expect(isSurveyDoc({ schema: 'something-else' })).toBe(false);
    expect(isSurveyDoc(null)).toBe(false);
    expect(isSurveyDoc('nope')).toBe(false);
  });

  it('builds a filename under the dykil-survey- prefix', () => {
    expect(surveyFilename('abc')).toBe('dykil-survey-abc.json');
  });
});

describe('normalizeSurveySettings', () => {
  it('treats missing settings as empty', () => {
    expect(normalizeSurveySettings(undefined)).toEqual({ settings: {} });
    expect(normalizeSurveySettings(null)).toEqual({ settings: {} });
  });

  it('drops allowAnonymous — every response is signed (imajin-ai#2536, ruling c) — and keeps the rest', () => {
    expect(normalizeSurveySettings({ allowAnonymous: true, multipleResponses: false, eventId: 'event_1', custom: 1 })).toEqual({
      settings: { multipleResponses: false, eventId: 'event_1', custom: 1 },
    });
    expect(normalizeSurveySettings({ allowAnonymous: false })).toEqual({ settings: {} });
  });

  it('does not mutate its input', () => {
    const input = { allowAnonymous: true, multipleResponses: true };
    normalizeSurveySettings(input);
    expect(input).toEqual({ allowAnonymous: true, multipleResponses: true });
  });

  it.each([
    ['a string', 'x'],
    ['a number', 3],
    ['an array', []],
  ])('rejects %s', (_label, value) => {
    expect(normalizeSurveySettings(value)).toEqual({ error: 'settings must be an object' });
  });

  it('rejects a non-boolean multipleResponses', () => {
    expect(normalizeSurveySettings({ multipleResponses: 'yes' })).toEqual({ error: 'settings.multipleResponses must be a boolean' });
  });

  it.each([[''], [5], [null]])('rejects an invalid eventId %j', (eventId) => {
    expect(normalizeSurveySettings({ eventId })).toEqual({ error: 'settings.eventId must be a non-empty string' });
  });
});
