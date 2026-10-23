import { feedbackRequest } from '@/lib/http/feedback';
import { planningQuery } from '@/lib/http/planning';
import { listFeedbackRefinements } from '@/lib/services/feedback';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; feedbackId: string }> },
) {
  return feedbackRequest(request, async (actor) => {
    const p = await context.params;
    return listFeedbackRefinements(
      actor,
      p.projectId,
      p.feedbackId,
      planningQuery(request),
    );
  });
}
