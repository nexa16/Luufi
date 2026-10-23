import { feedbackRequest, feedbackBody } from '@/lib/http/feedback';
import { planningQuery } from '@/lib/http/planning';
import { listFeedbackEntries, appendFeedback } from '@/lib/services/feedback';
type Context = { params: Promise<{ projectId: string; feedbackId: string }> };
export async function GET(request: Request, context: Context) {
  return feedbackRequest(request, async (actor) => {
    const p = await context.params;
    return listFeedbackEntries(
      actor,
      p.projectId,
      p.feedbackId,
      planningQuery(request),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return feedbackRequest(
    request,
    async (actor) => {
      const p = await context.params;
      const { requestKey, expectedRevision, ...input } =
        await feedbackBody(request);
      return appendFeedback(
        actor,
        p.projectId,
        p.feedbackId,
        input as never,
        expectedRevision as number,
        requestKey as string,
      );
    },
    201,
  );
}
