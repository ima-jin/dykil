'use client';

import { useMemo } from 'react';
import { SurveyForm } from '@/components/SurveyForm';
import { CARD, MUTED } from '@/components/ui';
import type { SurveyDraft } from '@/lib/client/builder-api';
import { buildSurveyJson } from '@/lib/survey-json';

/** Live preview of the survey as respondents will see it. */
export function PreviewPanel({ draft }: Readonly<{ draft: SurveyDraft }>) {
  const json = useMemo(() => buildSurveyJson({ elements: draft.elements, showQuestionNumbers: 'off' }), [draft.elements]);
  return (
    <section className={CARD}>
      <h2 className="mb-4 text-xl font-semibold">Live Preview</h2>
      <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <h3 className="mb-2 text-2xl font-bold">{draft.title || 'Untitled Survey'}</h3>
        {draft.description && <p className={`mb-6 ${MUTED}`}>{draft.description}</p>}
        {json ? (
          <SurveyForm json={json} preview />
        ) : (
          <div className="py-12 text-center text-sm text-gray-500">Preview will appear here as you add questions</div>
        )}
      </div>
    </section>
  );
}
