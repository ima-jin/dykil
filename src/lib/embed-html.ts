/**
 * Matches an opening/closing HTML tag name, used by the survey embed page's
 * `applyHtmlHandler` to allowlist a small set of safe formatting tags.
 *
 * Both character classes rely on the trailing `i` flag for
 * case-insensitivity, so the `A-Z` range is dropped (S5869: keeping it would
 * duplicate what `a-z` already matches case-insensitively) rather than
 * doubled up as `[a-zA-Z]`.
 */
export const HTML_TAG_PATTERN = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

/** Tags a survey title/description may carry. Everything else is dropped. */
const ALLOWED_TAGS = new Set(['a', 'b', 'i', 'em', 'strong', 'br', 'ul', 'ol', 'li', 'p', 'span']);

const HREF_PATTERN = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function anchorOpenTag(tag: string): string {
  const href = HREF_PATTERN.exec(tag);
  const target = href?.[1] ?? href?.[2] ?? '';
  const safeHref = /^https?:\/\//i.test(target) ? ` href="${escapeAttribute(target)}"` : '';
  return `<a${safeHref} target="_blank" rel="noopener noreferrer">`;
}

function rewriteTag(match: string, name: string): string {
  const tag = name.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return '';
  if (match.startsWith('</')) return `</${tag}>`;
  return tag === 'a' ? anchorOpenTag(match) : `<${tag}>`;
}

/**
 * Allowlist-sanitize the markup in a survey question's title or description.
 * Survey definitions are authored by their owner but rendered to respondents,
 * so only a small set of formatting tags survive, and they survive WITHOUT
 * their attributes (no `onclick`, no `style`) — the one exception is an
 * anchor's http(s) `href`, which always opens with `rel="noopener noreferrer"`.
 */
export function sanitizeSurveyHtml(text: string): string {
  return text.replaceAll(HTML_TAG_PATTERN, rewriteTag);
}
