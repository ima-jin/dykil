'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { SurveyRunner } from '@/components/SurveyRunner';
import { postToParent, resolveParentOrigin } from '@/lib/embed-protocol';

/** Tell the parent page how tall the embed is, now and whenever it resizes. */
function useHeightReporting(containerRef: React.RefObject<HTMLDivElement | null>, parentOrigin: () => string | null) {
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const send = () => postToParent({ type: 'survey-height', height: element.scrollHeight }, parentOrigin(), globalThis.parent);
    send();
    const observer = new ResizeObserver(send);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, parentOrigin]);
}

/**
 * The events-page embed. Same respondent journey as the full page, without the
 * chrome, plus the postMessage protocol parents already depend on
 * (`survey-height`, `survey-completed`) — see src/lib/embed-protocol.ts.
 */
export function EmbedSurvey({ surveyId }: Readonly<{ surveyId: string }>) {
  const searchParams = useSearchParams();
  const ticketId = searchParams.get('ticketId');
  const explicitOrigin = searchParams.get('parentOrigin');
  const containerRef = useRef<HTMLDivElement>(null);

  const parentOrigin = useCallback(
    () => resolveParentOrigin(explicitOrigin, globalThis.document?.referrer ?? ''),
    [explicitOrigin],
  );
  useHeightReporting(containerRef, parentOrigin);

  const onCompleted = useCallback(
    (answers: Record<string, unknown>) =>
      postToParent({ type: 'survey-completed', surveyId, answers }, parentOrigin(), globalThis.parent),
    [surveyId, parentOrigin],
  );

  return (
    <div ref={containerRef}>
      <SurveyRunner surveyId={surveyId} ticketId={ticketId} variant="embed" onCompleted={onCompleted} />
    </div>
  );
}
