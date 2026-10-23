import { FeedbackCollection } from '@/app/feedback';

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <FeedbackCollection key={projectId} projectId={projectId} />;
}
