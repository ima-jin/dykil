import { SurveyRunner } from '@/components/SurveyRunner';

export default async function SurveyPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <SurveyRunner surveyId={id} variant="page" />;
}
