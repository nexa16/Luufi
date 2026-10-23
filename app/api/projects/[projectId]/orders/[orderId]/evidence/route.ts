import { planningRead, planningQuery } from '@/lib/http/planning';
import { listOrderEvidence } from '@/lib/services/order-evidence';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; orderId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listOrderEvidence(
      actor,
      p.projectId,
      p.orderId,
      planningQuery(request),
    );
  });
}
