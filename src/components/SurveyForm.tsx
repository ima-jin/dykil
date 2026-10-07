'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';
import 'survey-core/survey-core.min.css';
import { sanitizeSurveyHtml } from '@/lib/embed-html';
import type { SurveyJson } from '@/lib/survey-json';
import { DARK_THEME_VARIABLES } from '@/lib/survey-theme';

function buildModel(json: SurveyJson, initialAnswers: Record<string, unknown> | null, preview: boolean): Model {
  const model = new Model(json);
  // We render our own completion screen (after the response is signed and submitted).
  model.showCompletedPage = false;
  model.applyTheme({ cssVariables: DARK_THEME_VARIABLES });
  model.onTextMarkdown.add((_, options) => {
    options.html = sanitizeSurveyHtml(options.text);
  });
  if (preview) model.showNavigationButtons = 'none';
  if (initialAnswers) model.mergeData(initialAnswers);
  return model;
}

/**
 * SurveyJS renders the questions; this app owns everything around them. The
 * model is built once per survey definition (pre-filled answers are an
 * initial value, not a controlled prop), and `onComplete` always receives a
 * clone because SurveyJS may keep mutating its own data object.
 */
export function SurveyForm({
  json,
  initialAnswers = null,
  preview = false,
  onComplete,
}: Readonly<{
  json: SurveyJson;
  initialAnswers?: Record<string, unknown> | null;
  /** Builder preview: questions are interactive but there is no Complete button. */
  preview?: boolean;
  onComplete?: (answers: Record<string, unknown>) => void;
}>) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildModel(json, initialAnswers, preview), [json]);

  useEffect(() => {
    const handler = (sender: Model) => onCompleteRef.current?.(structuredClone(sender.data));
    model.onComplete.add(handler);
    return () => model.onComplete.remove(handler);
  }, [model]);

  return <Survey model={model} />;
}
