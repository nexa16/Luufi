import { planningRead, planningQuery } from '@/lib/http/planning';
import { listVersionReleases } from '@/lib/services/project-versions';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; versionId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return listVersionReleases(
      actor,
      p.projectId,
      p.versionId,
      planningQuery(request),
    );
  });
}
