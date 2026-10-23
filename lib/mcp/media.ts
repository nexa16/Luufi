import { validates } from './schema';
const id = { type: 'string', minLength: 1, maxLength: 256 };
const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: 'integer',
  minimum,
  maximum,
});
const entity = { projectId: id, feedbackId: id, id };
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  readOnly = true,
) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: readOnly,
      openWorldHint: false,
      ...(!readOnly ? { destructiveHint: false, idempotentHint: true } : {}),
    },
  };
}
export const mediaTools = [
  tool(
    'media_get',
    'Liest einen projektgebundenen privaten Medienplatz.',
    entity,
  ),
  tool(
    'media_read',
    'Liest höchstens 64 KiB privater Medien samt Hash; ersetzt keine Inhaltsprüfung.',
    { ...entity, offset: integer(0), length: integer(1, 65536) },
  ),
  tool(
    'media_cleanup',
    'Bereinigt begrenzt abgelaufene Uploads und alte unreferenzierte Objekte.',
    {
      limit: integer(1, 50),
      requestKey: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._:-]+$',
      },
    },
    false,
  ),
];
export const isMediaTool = (name: string) =>
  mediaTools.some((t) => t.name === name);
export function validMediaArguments(
  name: string,
  args: Record<string, unknown>,
) {
  const tool = mediaTools.find((t) => t.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callMediaTool(
  name: string,
  args: Record<string, unknown>,
  actor: string,
) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const media = await import('@/lib/services/media');
    const p = args.projectId as string,
      id = args.id as string,
      f = args.feedbackId as string;
    let result: unknown;
    switch (name) {
      case 'media_get':
        result = await media.getAttachment(actor, p, f, id);
        break;
      case 'media_read':
        result = await media.readAttachment(
          actor,
          p,
          f,
          id,
          args.offset as number,
          args.length as number,
        );
        break;
      case 'media_cleanup':
        result = await media.cleanupAttachments(
          actor,
          args.limit as number,
          args.requestKey as string,
        );
        break;
      default:
        throw new PlanningError('validation', 'Unbekanntes Medienwerkzeug.');
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const failure =
      error instanceof PlanningError
        ? { code: error.code, error: error.message }
        : {
            code: 'unavailable',
            error: 'Medien sind vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
