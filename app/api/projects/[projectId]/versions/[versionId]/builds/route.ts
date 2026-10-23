import { planningRead, planningQuery } from '@/lib/http/planning';
import { listVersionBuilds } from '@/lib/services/project-versions';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; versionId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listVersionBuilds(
      actor,
      p.projectId,
      p.versionId,
      planningQuery(request),
    );
  });
}
