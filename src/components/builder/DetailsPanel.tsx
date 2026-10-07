'use client';

import { CARD, INPUT } from '@/components/ui';
import type { SurveyDraft } from '@/lib/client/builder-api';

const LABEL = 'mb-2 block text-sm font-medium';

/** Title, description and the settings that change who may respond. */
export function DetailsPanel({ draft, onChange }: Readonly<{ draft: SurveyDraft; onChange: (draft: SurveyDraft) => void }>) {
  return (
    <section className={CARD}>
      <h2 className="mb-4 text-xl font-semibold">Survey Details</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="survey-title" className={LABEL}>
            Title *
          </label>
          <input
            id="survey-title"
            type="text"
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            placeholder="Survey title"
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="survey-description" className={LABEL}>
            Description
          </label>
          <textarea
            id="survey-description"
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            placeholder="Optional description"
            rows={3}
            className={INPUT}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="survey-multiple"
            type="checkbox"
            checked={draft.settings.multipleResponses ?? false}
            onChange={(event) => onChange({ ...draft, settings: { ...draft.settings, multipleResponses: event.target.checked } })}
          />
          <label htmlFor="survey-multiple" className="text-sm">
            Allow more than one response per person
          </label>
        </div>
        <div>
          <label htmlFor="survey-event" className={LABEL}>
            Ticket-holders only: event ID (optional)
          </label>
          <input
            id="survey-event"
            type="text"
            value={draft.settings.eventId ?? ''}
            onChange={(event) => onChange({ ...draft, settings: { ...draft.settings, eventId: event.target.value } })}
            placeholder="Leave empty for an open survey"
            className={INPUT}
          />
        </div>
      </div>
    </section>
  );
}
