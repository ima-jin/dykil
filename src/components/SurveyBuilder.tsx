'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useToast } from '@ima-jin/ui';
import { DetailsPanel } from '@/components/builder/DetailsPanel';
import { PreviewPanel } from '@/components/builder/PreviewPanel';
import { QuestionsPanel } from '@/components/builder/QuestionsPanel';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Spinner } from '@/components/ui';
import { EMPTY_DRAFT, loadDraft, saveDraft, type SurveyDraft } from '@/lib/client/builder-api';
import { validateSurveyDraft } from '@/lib/survey-builder';

/** Create a survey, or edit one with `?id=<surveyId>`. Saving writes the signed survey document through `/api/surveys`. */
export function SurveyBuilder() {
  const router = useRouter();
  const { toast } = useToast();
  const editId = useSearchParams().get('id');
  const [draft, setDraft] = useState<SurveyDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(editId !== null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    loadDraft(editId).then((result) => {
      if (result.ok) {
        setDraft(result.data);
      } else {
        toast.error('Failed to load survey');
        router.push('/dashboard');
      }
      setLoading(false);
    });
    // `toast` / `router` are stable app-wide singletons; only a different survey should reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const save = async (publish: boolean) => {
    const problem = validateSurveyDraft(draft);
    if (problem) {
      toast.warning(problem);
      return;
    }
    setSaving(true);
    const result = await saveDraft(editId, draft, publish);
    setSaving(false);
    if (result.ok) {
      router.push('/dashboard');
    } else {
      toast.error(result.error);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{editId ? 'Edit Survey' : 'Create Survey'}</h1>
        <Link href="/dashboard" className={BUTTON_SECONDARY}>
          Cancel
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <DetailsPanel draft={draft} onChange={setDraft} />
          <QuestionsPanel
            elements={draft.elements}
            onChange={(elements) => setDraft({ ...draft, elements })}
            onWarn={toast.warning}
          />
          <div className="flex gap-3">
            <button type="button" onClick={() => save(false)} disabled={saving} className={`${BUTTON_SECONDARY} flex-1 py-3`}>
              {saving ? 'Saving...' : 'Save as Draft'}
            </button>
            <button type="button" onClick={() => save(true)} disabled={saving} className={`${BUTTON_PRIMARY} flex-1 py-3`}>
              {saving ? 'Publishing...' : 'Publish Survey'}
            </button>
          </div>
        </div>
        <div className="h-fit lg:sticky lg:top-6">
          <PreviewPanel draft={draft} />
        </div>
      </div>
    </div>
  );
}
