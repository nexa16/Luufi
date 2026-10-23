import { planningRead } from '@/lib/http/planning';
import { getOrder } from '@/lib/services/orders';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const params = await context.params;
    return getOrder(actor, params.projectId, params.orderId);
  });
}
