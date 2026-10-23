import { planningRead } from '@/lib/http/planning';
import { getLatestAvailableVersion } from '@/lib/services/project-versions';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return planningRead(request, async (actor) => {
    const p = await context.params;
    return getLatestAvailableVersion(actor, p.projectId);
  });
}
