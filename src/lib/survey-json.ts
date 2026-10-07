import type { SurveyJSElement } from '@/lib/survey';

/** The subset of the SurveyJS JSON schema this app renders. */
export interface SurveyJson {
  elements?: SurveyJSElement[];
  pages?: Array<{ elements: SurveyJSElement[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageElements(page: unknown): SurveyJSElement[] {
  if (!isObject(page) || !Array.isArray(page.elements)) return [];
  return page.elements.filter(Boolean) as SurveyJSElement[];
}

/**
 * Every question of a survey document's `fields` as one flat list. `fields`
 * is `{ elements }`, a multi-page `{ pages: [{ elements }] }`, or (legacy) a
 * bare array — the three shapes the kernel app's documents were stored in.
 */
export function flattenElements(fields: unknown): SurveyJSElement[] {
  if (Array.isArray(fields)) return fields.filter(Boolean) as SurveyJSElement[];
  if (!isObject(fields)) return [];
  if (Array.isArray(fields.pages)) return fields.pages.flatMap(pageElements);
  if (Array.isArray(fields.elements)) return fields.elements.filter(Boolean) as SurveyJSElement[];
  return [];
}

/**
 * Null-free SurveyJS JSON for a survey document, or null when it has no
 * renderable question (a null element or page would crash SurveyJS).
 */
export function buildSurveyJson(fields: unknown): SurveyJson | null {
  if (isObject(fields) && Array.isArray(fields.pages)) {
    const pages = fields.pages
      .filter(isObject)
      .map((page) => ({ ...page, elements: pageElements(page) }))
      .filter((page) => page.elements.length > 0);
    return pages.length > 0 ? { ...fields, pages } : null;
  }
  const elements = flattenElements(fields);
  if (elements.length === 0) return null;
  return isObject(fields) ? { ...fields, elements } : { elements };
}
