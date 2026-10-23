import { attachmentMimeTypes } from '@/lib/domain/feedback';
import { validates } from './schema';
const str = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', properties, required, additionalProperties: false });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: 'integer',
  minimum,
  maximum,
});
const requestKey = { ...str(128), pattern: '^[A-Za-z0-9._:-]+$' };
const project = { projectId: str() };
const entity = { ...project, id: str() };
const page = { limit: integer(1, 50), cursor: str(2048) };
const input = {
  text: { type: 'string', maxLength: 20000 },
  attachments: {
    type: 'array',
    maxItems: 10,
    items: object(
      {
        name: str(255),
        mimeType: { type: 'string', enum: attachmentMimeTypes },
        size: integer(1, 15000000),
      },
      ['name', 'mimeType', 'size'],
    ),
  },
};
const strings = (maxLength: number) => ({
  type: 'array',
  maxItems: 50,
  items: str(maxLength),
});
const refinement = object(
  {
    repositoryCommit: { ...str(40), pattern: '^[0-9a-fA-F]{40}$' },
    documentationPolicy: str(32),
    planningPolicy: str(32),
    summary: str(4000),
    orderIds: strings(256),
    questions: strings(2000),
    deferredReason: { type: 'string', maxLength: 4000 },
    rejectedReason: { type: 'string', maxLength: 4000 },
  },
  ['repositoryCommit', 'documentationPolicy', 'planningPolicy', 'summary'],
);
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly = true,
) {
  return {
    name,
    description,
    inputSchema: object(properties, required),
    annotations: {
      readOnlyHint: readOnly,
      openWorldHint: false,
      ...(!readOnly ? { destructiveHint: false, idempotentHint: true } : {}),
    },
  };
}
export const feedbackTools = [
  tool(
    'feedback_list',
    'Liest projektbezogenes Feedback mit Seitennavigation.',
    { ...project, ...page },
    ['projectId'],
  ),
  tool(
    'feedback_get',
    'Liest Inhaltsrevision und Refinementbedarf eines Feedbacks.',
    entity,
    ['projectId', 'id'],
  ),
  tool(
    'feedback_entries_list',
    'Liest unveränderliche Originale, Ergänzungen und Medienslots.',
    { ...entity, ...page },
    ['projectId', 'id'],
  ),
  tool(
    'feedback_refinements_list',
    'Liest dokumentierte Refinements und ihre Quellenfassung.',
    { ...entity, ...page },
    ['projectId', 'id'],
  ),
  tool(
    'feedback_create',
    'Speichert Originaltext und private Uploadplätze atomar.',
    { ...project, ...input, requestKey },
    ['projectId', 'text', 'requestKey'],
    false,
  ),
  tool(
    'feedback_append',
    'Ergänzt Feedback ohne Originale zu verändern.',
    { ...entity, ...input, expectedRevision: integer(), requestKey },
    ['projectId', 'id', 'text', 'expectedRevision', 'requestKey'],
    false,
  ),
  tool(
    'feedback_refine',
    'Dokumentiert geprüftes Refinement und Auftragsquellen; autorisiert keine Umsetzung.',
    { ...entity, input: refinement, expectedRevision: integer(), requestKey },
    ['projectId', 'id', 'input', 'expectedRevision', 'requestKey'],
    false,
  ),
  tool(
    'orders_feedback_sources',
    'Liest die unveränderlichen Feedbackquellen eines Auftrags.',
    { ...entity, ...page },
    ['projectId', 'id'],
  ),
];
export const isFeedbackTool = (name: string) =>
  feedbackTools.some((t) => t.name === name);
export function validFeedbackArguments(
  name: string,
  args: Record<string, unknown>,
) {
  const tool = feedbackTools.find((t) => t.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callFeedbackTool(
  name: string,
  args: Record<string, unknown>,
  actor: string,
) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const feedback = await import('@/lib/services/feedback');
    const p = args.projectId as string,
      id = args.id as string,
      key = args.requestKey as string,
      rev = args.expectedRevision as number;
    const options = {
      limit: args.limit as number | undefined,
      cursor: args.cursor as string | undefined,
    };
    let result: unknown;
    switch (name) {
      case 'feedback_list':
        result = await feedback.listFeedback(actor, p, options);
        break;
      case 'feedback_get':
        result = await feedback.getFeedback(actor, p, id);
        break;
      case 'feedback_entries_list':
        result = await feedback.listFeedbackEntries(actor, p, id, options);
        break;
      case 'feedback_refinements_list':
        result = await feedback.listFeedbackRefinements(actor, p, id, options);
        break;
      case 'orders_feedback_sources':
        result = await feedback.listOrderFeedbackSources(actor, p, id, options);
        break;
      case 'feedback_create':
      case 'feedback_append': {
        const {
          projectId: _p,
          id: _id,
          requestKey: _key,
          expectedRevision: _rev,
          ...input
        } = args;
        result =
          name === 'feedback_create'
            ? await feedback.createFeedback(actor, p, input as never, key)
            : await feedback.appendFeedback(
                actor,
                p,
                id,
                input as never,
                rev,
                key,
              );
        break;
      }
      case 'feedback_refine':
        result = await feedback.refineFeedback(
          actor,
          p,
          id,
          args.input as never,
          rev,
          key,
        );
        break;
      default:
        throw new PlanningError('validation', 'Unbekanntes Feedbackwerkzeug.');
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const failure =
      error instanceof PlanningError
        ? { code: error.code, error: error.message }
        : {
            code: 'unavailable',
            error: 'Feedback ist vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
