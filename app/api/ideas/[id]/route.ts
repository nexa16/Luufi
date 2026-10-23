import {
  ideaActor,
  ideaBody,
  ideaError,
  ideaJson,
} from '@/lib/http/project-ideas';
import {
  deleteProjectIdea,
  getProjectIdea,
  updateProjectIdea,
} from '@/lib/services/project-ideas';

type Context = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  try {
    const actor = ideaActor(request);
    const { id } = await context.params;
    return ideaJson({ idea: await getProjectIdea(actor, id) });
  } catch (error) {
    return ideaError(error);
  }
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  try {
    const actor = ideaActor(request, true);
    const body = await ideaBody(request);
    const { id } = await context.params;
    return ideaJson({
      idea: await updateProjectIdea(
        actor,
        id,
        body,
        body.expectedRevision as number,
        body.requestKey as string,
      ),
    });
  } catch (error) {
    return ideaError(error);
  }
}

export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  try {
    const actor = ideaActor(request, true);
    const body = await ideaBody(request);
    const { id } = await context.params;
    return ideaJson(
      await deleteProjectIdea(
        actor,
        id,
        body.expectedRevision as number,
        body.requestKey as string,
      ),
    );
  } catch (error) {
    return ideaError(error);
  }
}
