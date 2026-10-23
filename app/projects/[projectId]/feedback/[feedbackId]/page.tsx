import { FeedbackDetail } from '@/app/feedback';

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ projectId: string; feedbackId: string }>;
}) {
  const { projectId, feedbackId } = await params;
  return (
    <FeedbackDetail
      key={`${projectId}-${feedbackId}`}
      projectId={projectId}
      feedbackId={feedbackId}
    />
  );
}
