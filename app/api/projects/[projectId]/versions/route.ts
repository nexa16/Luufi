import { planningRead, planningQuery } from '@/lib/http/planning';
import { listProjectVersions } from '@/lib/services/project-versions';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listProjectVersions(actor, p.projectId, planningQuery(request));
  });
}
