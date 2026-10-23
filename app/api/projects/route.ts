import { planningQuery, planningRead } from '@/lib/http/planning';
import { listProjects } from '@/lib/services/projects';
export async function GET(request: Request) {
  return planningRead(request, (actor) =>
    listProjects(actor, planningQuery(request)),
  );
}
