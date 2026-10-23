import { planningRead, planningQuery } from '@/lib/http/planning';
import { listLifecycleEvents } from '@/lib/services/order-lifecycle';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listLifecycleEvents(
      actor,
      p.projectId,
      p.orderId,
      planningQuery(request),
    );
  });
}
