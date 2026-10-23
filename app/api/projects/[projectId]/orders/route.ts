import { planningQuery, planningRead } from '@/lib/http/planning';
import { listOrders } from '@/lib/services/orders';
import type { OrderStatus, OrderType } from '@/lib/domain/planning';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return planningRead(request, async (actor) => {
    const query = new URL(request.url).searchParams;
    const milestone = query.get('milestoneId');
    return listOrders(actor, (await context.params).projectId, {
      ...planningQuery(request),
      ...(milestone !== null
        ? { milestoneId: milestone === 'unplanned' ? null : milestone }
        : {}),
      ...(query.has('status')
        ? { status: query.get('status') as OrderStatus }
        : {}),
      ...(query.has('type') ? { type: query.get('type') as OrderType } : {}),
    });
  });
}
