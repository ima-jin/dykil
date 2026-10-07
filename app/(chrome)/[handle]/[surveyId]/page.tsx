import { SurveyRunner } from '@/components/SurveyRunner';

/** `/<handle>/<surveyId>` — the shape the kernel app linked to; the handle is decorative, the id decides. */
export default async function HandleSurveyPage({ params }: Readonly<{ params: Promise<{ handle: string; surveyId: string }> }>) {
  const { surveyId } = await params;
  return <SurveyRunner surveyId={decodeURIComponent(surveyId)} variant="page" />;
}
