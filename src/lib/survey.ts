import { createHash } from 'node:crypto';
import { canonicalize } from '@ima-jin/auth';

/**
 * A survey definition is a signed document — a media asset (see
 * src/lib/kernel/media.ts) owned by the creator's DID, containing this JSON
 * shape as its content. This app owns no table for it (Ryan's ruling,
 * 2026-09-22, DECISION #1985->c).
 */

export const SURVEY_DOC_SCHEMA = 'dykil.survey/v1';
export const SURVEY_FILENAME_PREFIX = 'dykil-survey-';

export type SurveyType = 'survey' | 'pre-event' | 'post-event' | 'form';
export type SurveyStatus = 'draft' | 'published' | 'closed';

export interface SurveyJSElement {
  type: string;
  name: string;
  title: string;
  isRequired?: boolean;
  visibleIf?: string;
  [key: string]: unknown;
}

export interface SurveyFields {
  elements: SurveyJSElement[];
}

export interface SurveySettings {
  /**
   * `allowAnonymous` is intentionally absent (Ryan's ruling on imajin-ai#2536,
   * 2026-10-06): every response is signed by its respondent's own DID, so
   * there is no anonymous path. `normalizeSurveySettings` drops it from any
   * incoming settings. Anonymous responses are deferred until the guest-
   * identity design lands.
   */
  /** When false/absent, a respondent holds at most one active response — a second one must supersede it. */
  multipleResponses?: boolean;
  /** Present only when this survey is ticket-gated — see src/lib/ticket-gate.ts. */
  eventId?: string;
}

export interface SurveyDoc {
  schema: typeof SURVEY_DOC_SCHEMA;
  ownerDid: string;
  title: string;
  description: string | null;
  fields: SurveyFields;
  settings: SurveySettings;
  type: SurveyType;
  status: SurveyStatus;
  createdAt: string;
  updatedAt: string;
}

export function surveyFilename(assetSeed: string): string {
  return `${SURVEY_FILENAME_PREFIX}${assetSeed}.json`;
}

type NormalizeResult = { error: string } | { fields: SurveyFields };

/**
 * Accept both SurveyJS format `{ elements: [...] }` and a legacy bare array,
 * normalizing to SurveyJS shape — ported from the original app's
 * `normalizeSurveyFields` (apps/dykil/app/api/surveys/route.ts) so existing
 * survey-authoring clients don't need to change their payload shape.
 */
export function normalizeSurveyFields(fields: unknown): NormalizeResult {
  if (fields && typeof fields === 'object' && !Array.isArray(fields) && 'elements' in fields) {
    const elements = (fields as { elements: unknown }).elements;
    if (!Array.isArray(elements) || elements.length === 0) {
      return { error: 'fields.elements array is required' };
    }
    for (const element of elements) {
      const candidate = element as Partial<SurveyJSElement>;
      if (!candidate.name || !candidate.type || !candidate.title) {
        return { error: 'Each field must have name, type, and title' };
      }
    }
    return { fields: fields as SurveyFields };
  }

  if (Array.isArray(fields)) {
    if (fields.length === 0) {
      return { error: 'fields array is required' };
    }
    return { fields: { elements: fields as SurveyJSElement[] } };
  }

  return { error: 'fields must be an array or SurveyJS schema' };
}

type NormalizeSettingsResult = { error: string } | { settings: SurveySettings };

/**
 * Validate and normalize a survey's `settings`. `allowAnonymous` is dropped
 * (see `SurveySettings`), so a legacy client that still sends it keeps working
 * but can never switch anonymous responses on. Other keys pass through.
 */
export function normalizeSurveySettings(settings: unknown): NormalizeSettingsResult {
  if (settings === undefined || settings === null) return { settings: {} };
  if (typeof settings !== 'object' || Array.isArray(settings)) {
    return { error: 'settings must be an object' };
  }
  const rest: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
  delete rest.allowAnonymous;
  if (rest.multipleResponses !== undefined && typeof rest.multipleResponses !== 'boolean') {
    return { error: 'settings.multipleResponses must be a boolean' };
  }
  if (rest.eventId !== undefined && (typeof rest.eventId !== 'string' || rest.eventId.length === 0)) {
    return { error: 'settings.eventId must be a non-empty string' };
  }
  return { settings: rest as SurveySettings };
}

function isFieldConditionMet(visibleIf: string | undefined, answers: Record<string, unknown>): boolean {
  if (!visibleIf) return true;
  const match = /\{(\w+)\}/.exec(visibleIf);
  if (!match) return true;
  const depValue = answers[match[1]];
  return visibleIf.includes(`"${depValue}"`) || visibleIf.includes(`'${depValue}'`);
}

/**
 * Validate submitted answers against a survey's field definitions. Returns
 * the first missing-required-field error message, or null when satisfied.
 * Ported from the original app's `findMissingRequiredField`.
 */
export function findMissingRequiredField(fields: SurveyFields, answers: Record<string, unknown>): string | null {
  for (const field of fields.elements) {
    if (field.isRequired && field.visibleIf && !isFieldConditionMet(field.visibleIf, answers)) {
      continue;
    }
    if (field.isRequired && !answers[field.name]) {
      return `Field "${field.title}" is required`;
    }
  }
  return null;
}

/**
 * The `<docHash>` a response attestation says it is "about" (Ryan's ruling).
 * A plain SHA-256 over the doc's canonical JSON — content-addressing the
 * survey definition without depending on the kernel's own asset CID scheme.
 */
export function computeDocHash(doc: SurveyDoc): string {
  return `sha256:${createHash('sha256').update(canonicalize(doc)).digest('hex')}`;
}

export function isSurveyDoc(value: unknown): value is SurveyDoc {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { schema?: unknown }).schema === SURVEY_DOC_SCHEMA
  );
}
