import { describe, expect, it } from 'vitest';
import { HTML_TAG_PATTERN, sanitizeSurveyHtml } from '../embed-html';

// The pre-S5869 pattern, kept only to prove the deduplicated one matches identically.
const OLD_HTML_TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi;

function allMatches(pattern: RegExp, input: string): Array<[string, string]> {
  return [...input.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => [match[0], match[1]]);
}

describe('HTML_TAG_PATTERN (S5869 regression, ported from the kernel app)', () => {
  it.each([
    '<p>hello <b>world</b></p>',
    '<P>hello <B>world</B></P>',
    '<Span>mixed <EM>case</EM></Span>',
    '<a href="https://example.com">link</a>',
    '<br/>',
    '<BR class="x" />',
    '<script>alert(1)</script>',
    'just plain text, no tags here',
    '<3 not a tag',
  ])('matches identically to the original pattern for %j', (input) => {
    expect(allMatches(HTML_TAG_PATTERN, input)).toEqual(allMatches(OLD_HTML_TAG_PATTERN, input));
  });
});

describe('sanitizeSurveyHtml', () => {
  it.each([
    ['plain text is untouched', 'no markup here', 'no markup here'],
    ['allowed tags survive', '<p>a <b>b</b> <em>c</em></p>', '<p>a <b>b</b> <em>c</em></p>'],
    ['tag names are lower-cased', '<STRONG>x</STRONG>', '<strong>x</strong>'],
    ['void tags keep working', 'a<br/>b<BR class="x" />c', 'a<br>b<br>c'],
    ['disallowed tags are removed but their text stays', '<script>alert(1)</script>ok', 'alert(1)ok'],
    ['disallowed void tags are removed', 'a<img src=x onerror=alert(1)>b', 'ab'],
    ['attributes are stripped from allowed tags', '<span onclick="x()" style="color:red">hi</span>', '<span>hi</span>'],
    ['closing tags drop their attributes too', '<b>x</b onclick=y>', '<b>x</b>'],
    [
      'an https anchor keeps its href and gains rel/target',
      '<a href="https://example.com/a?b=1&c=2" onclick="x()">go</a>',
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">go</a>',
    ],
    ['a single-quoted href works', "<a href='http://example.com'>go</a>", '<a href="http://example.com" target="_blank" rel="noopener noreferrer">go</a>'],
    ['a javascript: href is dropped', '<a href="javascript:alert(1)">go</a>', '<a target="_blank" rel="noopener noreferrer">go</a>'],
    ['an anchor without an href is still safe', '<a>go</a>', '<a target="_blank" rel="noopener noreferrer">go</a>'],
    ['quotes in an href cannot break out of the attribute', '<a href="https://x.y/&quot;onmouseover=1">go</a>', '<a href="https://x.y/&amp;quot;onmouseover=1" target="_blank" rel="noopener noreferrer">go</a>'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeSurveyHtml(input)).toBe(expected);
  });
});
