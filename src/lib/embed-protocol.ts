/**
 * The postMessage contract an events-page embed relies on (unchanged from the
 * kernel app, so existing parent pages keep working):
 *   child -> parent  { type: 'survey-height', height }
 *   child -> parent  { type: 'survey-completed', surveyId, answers? }
 * Messages are only ever posted to a resolvable parent origin — never `*`.
 */
export type EmbedMessage =
  | { type: 'survey-height'; height: number }
  | { type: 'survey-completed'; surveyId: string; answers?: Record<string, unknown> };

/** `?parentOrigin=` when given, else the origin of `document.referrer`, else null. */
export function resolveParentOrigin(explicitOrigin: string | null, referrer: string): string | null {
  if (explicitOrigin) return explicitOrigin;
  if (!referrer) return null;
  try {
    return new URL(referrer).origin;
  } catch {
    return null;
  }
}

export function postToParent(message: EmbedMessage, targetOrigin: string | null, parent: Pick<Window, 'postMessage'> | null): boolean {
  if (!targetOrigin || !parent) return false;
  parent.postMessage(message, targetOrigin);
  return true;
}
