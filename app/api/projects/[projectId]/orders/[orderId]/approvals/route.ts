import { planningRead, planningQuery } from '@/lib/http/planning';
import { listOrderApprovals } from '@/lib/services/order-lifecycle';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listOrderApprovals(
      actor,
      p.projectId,
      p.orderId,
      planningQuery(request),
    );
  });
}
