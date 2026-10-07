import { Suspense } from 'react';
import { EmbedSurvey } from '@/components/EmbedSurvey';
import { Spinner } from '@/components/ui';

export default async function EmbedPage({ params }: Readonly<{ params: Promise<{ surveyId: string }> }>) {
  const { surveyId } = await params;
  // EmbedSurvey reads `?ticketId=` / `?parentOrigin=`, which needs a Suspense boundary.
  return (
    <Suspense fallback={<Spinner />}>
      <EmbedSurvey surveyId={decodeURIComponent(surveyId)} />
    </Suspense>
  );
}
