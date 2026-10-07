import { HandleSurveys } from '@/components/HandleSurveys';

export default async function HandlePage({ params }: Readonly<{ params: Promise<{ handle: string }> }>) {
  const { handle } = await params;
  return <HandleSurveys handle={decodeURIComponent(handle)} />;
}
