import { siteIdentity } from '@/lib/auth/site';
import { PlanningError } from '@/lib/services/planning-store';

export const planningJson = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function planningRead(
  request: Request,
  run: (actor: string) => Promise<unknown>,
) {
  try {
    const actor = siteIdentity(request);
    if (!actor)
      throw new PlanningError('unauthorized', 'Bitte melde dich bei Luufi an.');
    return planningJson(await run(actor));
  } catch (error) {
    return error instanceof PlanningError
      ? planningJson({ code: error.code, error: error.message }, error.status)
      : planningJson(
          {
            code: 'unavailable',
            error: 'Die Projektplanung ist vorübergehend nicht verfügbar.',
          },
          503,
        );
  }
}
export function planningQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  const raw = query.get('limit');
  return {
    limit: raw === null ? undefined : /^\d+$/.test(raw) ? Number(raw) : NaN,
    cursor: query.get('cursor'),
  };
}
