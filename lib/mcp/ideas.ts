const id = { type: 'string', minLength: 1, maxLength: 256 } as const;
const text = { type: 'string', minLength: 1, maxLength: 280 } as const;
const detail = { type: 'string', maxLength: 4000 } as const;
const expectedRevision = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const requestKey = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9._:-]+$',
} as const;
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const mutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const ideaTools = [
  {
    name: 'ideas_list',
    description:
      'Liest eigenständige Projektideen mit stabiler Seitennavigation.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        cursor: { type: 'string', minLength: 1, maxLength: 1024 },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'ideas_get',
    description: 'Liest eine Projektidee anhand ihrer unveränderlichen ID.',
    inputSchema: {
      type: 'object',
      properties: { id },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'ideas_create',
    description:
      'Erstellt eine eigenständige Projektidee mit dauerhaftem Wiederholungsschlüssel.',
    inputSchema: {
      type: 'object',
      properties: { text, detail, requestKey },
      required: ['text', 'requestKey'],
      additionalProperties: false,
    },
    annotations: mutation,
  },
  {
    name: 'ideas_update',
    description:
      'Bearbeitet eine Projektidee nur bei passender Revision und speichert einen Wiederholungsbeleg.',
    inputSchema: {
      type: 'object',
      properties: { id, text, detail, expectedRevision, requestKey },
      required: ['id', 'text', 'expectedRevision', 'requestKey'],
      additionalProperties: false,
    },
    annotations: mutation,
  },
  {
    name: 'ideas_delete',
    description:
      'Löscht ausschließlich die gewählte Projektidee bei passender Revision.',
    inputSchema: {
      type: 'object',
      properties: { id, expectedRevision, requestKey },
      required: ['id', 'expectedRevision', 'requestKey'],
      additionalProperties: false,
    },
    annotations: { ...mutation, destructiveHint: true },
  },
] as const;

export function isIdeaTool(name: string): boolean {
  return ideaTools.some((tool) => tool.name === name);
}

export function validIdeaArguments(
  name: string,
  args: Record<string, unknown>,
): boolean {
  const tool = ideaTools.find((candidate) => candidate.name === name);
  if (!tool) return false;
  const schema = tool.inputSchema;
  const required: readonly string[] =
    'required' in schema ? schema.required : [];
  if (!required.every((key) => key in args)) return false;
  return Object.entries(args).every(([key, value]) => {
    if (!Object.hasOwn(schema.properties, key)) return false;
    const field = schema.properties[key as keyof typeof schema.properties] as {
      type: string;
      minimum?: number;
      maximum?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
    if (field.type === 'integer') {
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= field.minimum! &&
        value <= field.maximum!
      );
    }
    return (
      typeof value === 'string' &&
      value.length >= (field.minLength ?? 0) &&
      value.length <= field.maxLength! &&
      (!field.pattern || new RegExp(field.pattern).test(value))
    );
  });
}

export async function callIdeaTool(
  name: string,
  args: Record<string, unknown>,
  actor: string,
) {
  // Loading persistence only for an actual authenticated call keeps discovery
  // static and independent from D1 availability.
  const service = await import('@/lib/services/project-ideas');
  try {
    let result: unknown;
    switch (name) {
      case 'ideas_list':
        result = await service.listProjectIdeas(actor, {
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
        });
        break;
      case 'ideas_get':
        result = await service.getProjectIdea(actor, args.id as string);
        break;
      case 'ideas_create':
        result = await service.createProjectIdea(
          actor,
          args,
          args.requestKey as string,
        );
        break;
      case 'ideas_update':
        result = await service.updateProjectIdea(
          actor,
          args.id as string,
          args,
          args.expectedRevision as number,
          args.requestKey as string,
        );
        break;
      case 'ideas_delete':
        result = await service.deleteProjectIdea(
          actor,
          args.id as string,
          args.expectedRevision as number,
          args.requestKey as string,
        );
        break;
      default:
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                code: 'validation',
                error: 'Unbekanntes Projektideen-Werkzeug.',
              }),
            },
          ],
        };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const failure =
      error instanceof service.ProjectIdeaError
        ? { code: error.code, error: error.message }
        : {
            code: 'unavailable',
            error:
              'Die Projektideen sind vorübergehend nicht verfügbar. Bitte versuche es erneut.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
