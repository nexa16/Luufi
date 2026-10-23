import { MilestoneCollection } from '@/app/planning';

export default async function MilestonesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <MilestoneCollection projectId={projectId} />;
}
