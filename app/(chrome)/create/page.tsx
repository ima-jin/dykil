import { Suspense } from 'react';
import { SurveyBuilder } from '@/components/SurveyBuilder';
import { Spinner } from '@/components/ui';

export default function CreatePage() {
  // The builder reads `?id=` (edit mode), which needs a Suspense boundary.
  return (
    <Suspense fallback={<Spinner />}>
      <SurveyBuilder />
    </Suspense>
  );
}
