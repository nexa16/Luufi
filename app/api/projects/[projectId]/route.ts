import { planningRead } from '@/lib/http/planning';
import { getProject } from '@/lib/services/projects';
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return planningRead(request, async (actor) =>
    getProject(actor, (await context.params).projectId),
  );
}
