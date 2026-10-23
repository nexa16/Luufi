import { VersionCollection } from '@/app/versions';
export default async function VersionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <VersionCollection key={projectId} projectId={projectId} />;
}
