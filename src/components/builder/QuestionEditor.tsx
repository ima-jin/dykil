'use client';

import { useCallback, useRef, useState } from 'react';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '@/components/ui';
import { CHOICE_TYPES, choiceText, type QuestionElement } from '@/lib/survey-builder';

type EditorProps = Readonly<{
  question: QuestionElement;
  onChange: (question: QuestionElement) => void;
  /** Distinguishes the "new question" form from an inline edit so element ids stay unique. */
  idPrefix: string;
}>;

const LABEL = 'mb-1 block text-sm font-medium';

interface ChoiceRow {
  id: number;
  text: string;
}

/** Choice list with stable row ids — a row keeps its identity (and focus) while its text is edited. */
function ChoicesEditor({ question, onChange, idPrefix }: EditorProps) {
  const nextId = useRef(0);
  const makeRow = useCallback((text: string): ChoiceRow => ({ id: nextId.current++, text }), []);
  const [rows, setRows] = useState<ChoiceRow[]>(() => (question.choices ?? []).map((choice) => makeRow(choiceText(choice))));

  const update = (next: ChoiceRow[]) => {
    setRows(next);
    onChange({ ...question, choices: next.map((row) => row.text) });
  };

  return (
    <div>
      <label htmlFor={`${idPrefix}-choice-first`} className={LABEL}>
        Answer Choices
      </label>
      {rows.map((row, position) => (
        <div key={row.id} className="mb-2 flex gap-2">
          <input
            id={position === 0 ? `${idPrefix}-choice-first` : undefined}
            type="text"
            value={row.text}
            onChange={(event) => update(rows.map((r) => (r.id === row.id ? { ...r, text: event.target.value } : r)))}
            placeholder={`Choice ${position + 1}`}
            aria-label={`Choice ${position + 1}`}
            className={`${INPUT} flex-1`}
          />
          {position > 0 && (
            <button
              type="button"
              onClick={() => update(rows.filter((r) => r.id !== row.id))}
              aria-label={`Remove choice ${position + 1}`}
              className="rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => update([...rows, makeRow('')])} className="text-sm text-orange-500 hover:text-orange-600">
        + Add choice
      </button>
    </div>
  );
}

const RATING_BOUNDS = [
  { key: 'rateMin', label: 'Min Value', fallback: 1 },
  { key: 'rateMax', label: 'Max Value', fallback: 5 },
] as const;

function RatingRangeEditor({ question, onChange, idPrefix }: EditorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {RATING_BOUNDS.map(({ key, label, fallback }) => (
        <div key={key}>
          <label htmlFor={`${idPrefix}-${key}`} className={LABEL}>
            {label}
          </label>
          <input
            id={`${idPrefix}-${key}`}
            type="number"
            value={question[key] ?? fallback}
            onChange={(event) => onChange({ ...question, [key]: Number(event.target.value) })}
            className={INPUT}
          />
        </div>
      ))}
    </div>
  );
}

function TextInputTypeEditor({ question, onChange, idPrefix }: EditorProps) {
  return (
    <div>
      <label htmlFor={`${idPrefix}-input-type`} className={LABEL}>
        Input Type
      </label>
      <select
        id={`${idPrefix}-input-type`}
        value={question.inputType ?? 'text'}
        onChange={(event) => onChange({ ...question, inputType: event.target.value })}
        className={INPUT}
      >
        <option value="text">Text</option>
        <option value="email">Email</option>
        <option value="number">Number</option>
      </select>
    </div>
  );
}

/** The type-specific part of the form. */
function TypeOptions(props: EditorProps) {
  const { type } = props.question;
  if (CHOICE_TYPES.has(type)) return <ChoicesEditor {...props} />;
  if (type === 'rating') return <RatingRangeEditor {...props} />;
  if (type === 'text') return <TextInputTypeEditor {...props} />;
  return null;
}

/** Add / edit one question. */
export function QuestionEditor({
  question,
  isEditing,
  onChange,
  onSave,
  onCancel,
}: Readonly<{
  question: QuestionElement;
  isEditing: boolean;
  onChange: (question: QuestionElement) => void;
  onSave: () => void;
  onCancel: () => void;
}>) {
  const idPrefix = isEditing ? 'q-edit' : 'q-new';
  // Focus the title once when the form mounts (declarative `autoFocus` is flagged by Sonar S9379).
  const focusOnMount = useCallback((element: HTMLInputElement | null) => element?.focus(), []);

  return (
    <div className="mb-2 rounded-lg border-2 border-orange-500/50 bg-gray-50 p-4 dark:bg-gray-900">
      <h3 className="mb-3 text-lg font-semibold">{isEditing ? 'Edit Question' : `Add ${question.type} Question`}</h3>
      <div className="space-y-3">
        <div>
          <label htmlFor={`${idPrefix}-title`} className={LABEL}>
            Question Text *
          </label>
          <input
            id={`${idPrefix}-title`}
            ref={focusOnMount}
            type="text"
            value={question.title}
            onChange={(event) => onChange({ ...question, title: event.target.value })}
            placeholder="What would you like to ask?"
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-export`} className={LABEL}>
            Export Label (optional)
          </label>
          <input
            id={`${idPrefix}-export`}
            type="text"
            value={question.exportLabel ?? ''}
            onChange={(event) => onChange({ ...question, exportLabel: event.target.value || undefined })}
            placeholder="Short name for CSV export (optional)"
            className={INPUT}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-required`}
            type="checkbox"
            checked={question.isRequired ?? false}
            onChange={(event) => onChange({ ...question, isRequired: event.target.checked })}
          />
          <label htmlFor={`${idPrefix}-required`} className="text-sm">
            Required question
          </label>
        </div>
        <TypeOptions question={question} onChange={onChange} idPrefix={idPrefix} />
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onSave} className={BUTTON_PRIMARY}>
            {isEditing ? 'Save Changes' : 'Add Question'}
          </button>
          <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
