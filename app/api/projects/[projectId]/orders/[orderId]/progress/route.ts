import { planningRead, planningQuery } from '@/lib/http/planning';
import { listOrderProgress } from '@/lib/services/order-execution';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listOrderProgress(
      actor,
      p.projectId,
      p.orderId,
      planningQuery(request),
    );
  });
}
