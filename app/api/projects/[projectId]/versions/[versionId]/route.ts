import { planningRead } from '@/lib/http/planning';
import { getProjectVersion } from '@/lib/services/project-versions';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; versionId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return getProjectVersion(actor, p.projectId, p.versionId);
  });
}
