import { feedbackRequest } from '@/lib/http/feedback';
import { planningQuery } from '@/lib/http/planning';
import { listOrderFeedbackSources } from '@/lib/services/feedback';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return feedbackRequest(request, async (actor) => {
    const p = await context.params;
    return listOrderFeedbackSources(
      actor,
      p.projectId,
      p.orderId,
      planningQuery(request),
    );
  });
}
