import { feedbackRequest } from '@/lib/http/feedback';
import { getFeedback } from '@/lib/services/feedback';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; feedbackId: string }> },
) {
  return feedbackRequest(request, async (actor) => {
    const p = await context.params;
    return getFeedback(actor, p.projectId, p.feedbackId);
  });
}
