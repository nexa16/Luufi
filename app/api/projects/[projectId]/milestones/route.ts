import { planningQuery, planningRead } from '@/lib/http/planning';
import { listMilestones } from '@/lib/services/milestones';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return planningRead(request, async (actor) =>
    listMilestones(
      actor,
      (await context.params).projectId,
      planningQuery(request),
    ),
  );
}
