import { feedbackRequest, feedbackBody } from '@/lib/http/feedback';
import { planningQuery } from '@/lib/http/planning';
import { listFeedback, createFeedback } from '@/lib/services/feedback';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) {
  return feedbackRequest(request, async (actor) =>
    listFeedback(
      actor,
      (await context.params).projectId,
      planningQuery(request),
    ),
  );
}
export async function POST(request: Request, context: Context) {
  return feedbackRequest(
    request,
    async (actor) => {
      const { requestKey, ...input } = await feedbackBody(request);
      return createFeedback(
        actor,
        (await context.params).projectId,
        input as never,
        requestKey as string,
      );
    },
    201,
  );
}
