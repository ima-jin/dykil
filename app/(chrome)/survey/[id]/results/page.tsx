import { Results } from '@/components/Results';

export default async function SurveyResultsPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <Results surveyId={id} />;
}
