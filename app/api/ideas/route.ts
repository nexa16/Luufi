import {
  ideaActor,
  ideaBody,
  ideaError,
  ideaJson,
} from '@/lib/http/project-ideas';
import {
  createProjectIdea,
  listProjectIdeas,
} from '@/lib/services/project-ideas';

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = ideaActor(request);
    const query = new URL(request.url).searchParams;
    const limit = query.get('limit');
    return ideaJson(
      await listProjectIdeas(actor, {
        limit:
          limit === null
            ? undefined
            : /^\d+$/.test(limit)
              ? Number(limit)
              : NaN,
        cursor: query.get('cursor'),
      }),
    );
  } catch (error) {
    return ideaError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = ideaActor(request, true);
    const body = await ideaBody(request);
    return ideaJson(
      { idea: await createProjectIdea(actor, body, body.requestKey as string) },
      201,
    );
  } catch (error) {
    return ideaError(error);
  }
}
