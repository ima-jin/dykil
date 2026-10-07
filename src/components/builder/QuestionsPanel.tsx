'use client';

import { useState } from 'react';
import { QuestionEditor } from '@/components/builder/QuestionEditor';
import { BUTTON_PRIMARY, CARD } from '@/components/ui';
import {
  describeQuestion,
  moveQuestion,
  newQuestion,
  QUESTION_TYPES,
  removeQuestion,
  upsertQuestion,
  validateQuestion,
  type QuestionElement,
  type QuestionType,
} from '@/lib/survey-builder';

const SMALL_BUTTON = 'rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-30 dark:border-gray-700';

/** `index` null = the "new question" form; a number = inline-editing that row. */
interface OpenForm {
  index: number | null;
  question: QuestionElement;
}

function QuestionRow({
  question,
  index,
  count,
  onMove,
  onEdit,
  onDelete,
}: Readonly<{
  question: QuestionElement;
  index: number;
  count: number;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}>) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex-1">
        <div className="text-sm font-medium">
          {question.title}
          {question.isRequired && <span className="ml-1 text-red-500">*</span>}
        </div>
        <div className="text-xs text-gray-500">{describeQuestion(question)}</div>
        {question.exportLabel && <div className="text-xs text-gray-400">CSV: &quot;{question.exportLabel}&quot;</div>}
      </div>
      <div className="flex gap-1">
        <button type="button" onClick={() => onMove(index, 'up')} disabled={index === 0} aria-label="Move up" className={SMALL_BUTTON}>
          ↑
        </button>
        <button type="button" onClick={() => onMove(index, 'down')} disabled={index === count - 1} aria-label="Move down" className={SMALL_BUTTON}>
          ↓
        </button>
        <button type="button" onClick={() => onEdit(index)} className={SMALL_BUTTON}>
          Edit
        </button>
        <button type="button" onClick={() => onDelete(index)} className={`${SMALL_BUTTON} border-red-300 text-red-600 dark:border-red-700`}>
          Delete
        </button>
      </div>
    </div>
  );
}

/** The question list and its add / edit / reorder / delete controls. */
export function QuestionsPanel({
  elements,
  onChange,
  onWarn,
}: Readonly<{ elements: QuestionElement[]; onChange: (elements: QuestionElement[]) => void; onWarn: (message: string) => void }>) {
  const [form, setForm] = useState<OpenForm | null>(null);

  const open = (type: QuestionType) => setForm({ index: null, question: newQuestion(type) });

  const save = () => {
    if (!form) return;
    const problem = validateQuestion(form.question);
    if (problem) {
      onWarn(problem);
      return;
    }
    onChange(upsertQuestion(elements, form.question, form.index));
    setForm(null);
  };

  const remove = (index: number) => {
    if (globalThis.confirm('Delete this question?')) onChange(removeQuestion(elements, index));
  };

  const editor = (isEditing: boolean) =>
    form && (
      <QuestionEditor
        question={form.question}
        isEditing={isEditing}
        onChange={(question) => setForm({ ...form, question })}
        onSave={save}
        onCancel={() => setForm(null)}
      />
    );

  return (
    <section className={CARD}>
      <h2 className="mb-4 text-xl font-semibold">Questions ({elements.length})</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {QUESTION_TYPES.map(({ type, label }) => (
          <button key={type} type="button" onClick={() => open(type)} className={`${BUTTON_PRIMARY} text-sm`}>
            + {label}
          </button>
        ))}
      </div>
      {form?.index === null && editor(false)}
      <div className="space-y-2">
        {elements.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No questions yet. Add a question using the buttons above.</div>}
        {elements.map((question, index) => (
          <div key={question.name}>
            {form?.index === index ? (
              editor(true)
            ) : (
              <QuestionRow
                question={question}
                index={index}
                count={elements.length}
                onMove={(from, direction) => onChange(moveQuestion(elements, from, direction))}
                onEdit={(at) => setForm({ index: at, question: { ...elements[at] } })}
                onDelete={remove}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
