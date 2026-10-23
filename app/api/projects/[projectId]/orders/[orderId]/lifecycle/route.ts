import { planningRead } from '@/lib/http/planning';
import { getOrderLifecycle } from '@/lib/services/order-lifecycle';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return getOrderLifecycle(actor, p.projectId, p.orderId);
  });
}
