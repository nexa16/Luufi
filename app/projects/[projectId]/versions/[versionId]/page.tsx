import { VersionDetail } from '@/app/versions';
export default async function VersionPage({
  params,
}: {
  params: Promise<{ projectId: string; versionId: string }>;
}) {
  const { projectId, versionId } = await params;
  return (
    <VersionDetail
      key={`${projectId}-${versionId}`}
      projectId={projectId}
      versionId={versionId}
    />
  );
}
