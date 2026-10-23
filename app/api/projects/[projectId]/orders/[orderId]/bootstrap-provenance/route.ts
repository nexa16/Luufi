import { planningRead } from '@/lib/http/planning';
import { getOrderBootstrapProvenance } from '@/lib/services/bootstrap';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return getOrderBootstrapProvenance(actor, p.projectId, p.orderId);
  });
}
