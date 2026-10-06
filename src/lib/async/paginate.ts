export interface Page<T, C> {
  items: T[];
  /** Cursor for the next page, or null when this was the last one. */
  next: C | null;
}

/**
 * Collect every page of a cursor-paged (or offset-paged) listing into one
 * array, following `next` until it is null.
 *
 * Written recursively on purpose: each page's cursor depends on the previous
 * response, so the requests are inherently sequential, and recursion expresses
 * that without an `await` inside a loop (Sonar S9382). `maxPages` bounds the
 * walk, and a cursor that fails to advance ends it instead of spinning.
 */
export async function collectPages<T, C>(
  fetchPage: (cursor: C | null) => Promise<Page<T, C>>,
  maxPages: number,
  cursor: C | null = null,
  collected: T[] = [],
): Promise<T[]> {
  const page = await fetchPage(cursor);
  collected.push(...page.items);
  if (page.next === null || page.next === cursor || maxPages <= 1) {
    return collected;
  }
  return collectPages(fetchPage, maxPages - 1, page.next, collected);
}
