const str = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
const optionalText = (maxLength = 4000) => ({ type: 'string', maxLength });
const revision = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const requestKey = { ...str(128), pattern: '^[A-Za-z0-9._:-]+$' };
const id = str();
const nullableId = { anyOf: [id, { type: 'null' }] };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = (maxItems: number, maxLength: number) => ({
  type: 'array',
  items: str(maxLength),
  maxItems,
});
const page = {
  limit: { type: 'integer', minimum: 1, maximum: 50 },
  cursor: str(2048),
};
const types = ['feature', 'improvement', 'defect', 'technical'];
const statuses = [
  'draft',
  'ready',
  'implementing',
  'implemented',
  'done',
  'archived',
];
const relations = ['depends_on', 'related', 'originated_from', 'replaces'];
const spec = object(
  {
    title: str(280),
    goal: str(4000),
    origin: str(4000),
    problem: optionalText(),
    scope: optionalText(),
    exclusions: optionalText(),
    flows: optionalText(),
    criteria: {
      type: 'array',
      maxItems: 50,
      items: object({ id: str(64), text: str(1000) }, ['id', 'text']),
    },
    testStrategy: optionalText(),
    prerequisites: optionalText(),
    documentation: optionalText(),
    context: object({
      repositoryCommit: optionalText(40),
      documentationPolicy: optionalText(32),
    }),
    sources: strings(50, 1000),
  },
  ['title', 'goal', 'origin'],
);
const config = {
  name: str(280),
  repository: str(1000),
  integrationBranch: str(200),
  productionBranch: { type: 'string', enum: ['main', 'master'] },
  documentationPaths: strings(20, 256),
  deploymentHints: optionalText(),
};
const projectId = { projectId: id };
const entity = { ...projectId, id };
const relation = {
  ...entity,
  targetId: id,
  type: { type: 'string', enum: relations },
  expectedRevision: revision,
  requestKey,
};
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly = false,
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
export const planningTools = [
  tool(
    'projects_list',
    'Liest registrierte Projekte mit Seitennavigation.',
    page,
    [],
    true,
  ),
  tool(
    'projects_get',
    'Liest Projektkonfiguration und Planungsrevision.',
    { id },
    ['id'],
    true,
  ),
  tool(
    'projects_register',
    'Registriert ein Projekt mit dauerhaftem eindeutigem Kürzel.',
    { key: str(20), ...config, requestKey },
    ['key', 'name', 'repository', 'requestKey'],
  ),
  tool(
    'projects_update',
    'Ändert Projektstammdaten bei passender Revision; Kürzel bleibt unverändert.',
    { id, ...config, expectedRevision: revision, requestKey },
    ['id', 'name', 'repository', 'expectedRevision', 'requestKey'],
  ),
  tool(
    'milestones_list',
    'Liest Milestones in ihrer ausdrücklichen Reihenfolge.',
    { ...projectId, ...page },
    ['projectId'],
    true,
  ),
  tool(
    'milestones_get',
    'Liest einen projektzugehörigen Milestone.',
    entity,
    ['projectId', 'id'],
    true,
  ),
  tool(
    'milestones_create',
    'Erstellt einen offenen Milestone am Ende der Planung.',
    { ...projectId, title: str(280), description: optionalText(), requestKey },
    ['projectId', 'title', 'requestKey'],
  ),
  tool(
    'milestones_update',
    'Bearbeitet einen offenen Milestone mit Revisionsprüfung.',
    {
      ...entity,
      title: str(280),
      description: optionalText(),
      expectedRevision: revision,
      requestKey,
    },
    ['projectId', 'id', 'title', 'expectedRevision', 'requestKey'],
  ),
  tool(
    'milestones_move',
    'Verschiebt einen offenen Milestone vor einen Anker; null hängt an.',
    {
      ...entity,
      beforeId: nullableId,
      expectedPlanningRevision: revision,
      requestKey,
    },
    ['projectId', 'id', 'beforeId', 'expectedPlanningRevision', 'requestKey'],
  ),
];

// A bounded subset matching exactly our static discovery schemas.
function validates(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.some((s) => validates(value, s));
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) return false;
  switch (schema.type) {
    case 'null':
      return value === null;
    case 'string':
      return (
        typeof value === 'string' &&
        value.length >= ((schema.minLength as number) ?? 0) &&
        value.length <= ((schema.maxLength as number) ?? Infinity) &&
        (!schema.pattern || new RegExp(schema.pattern as string).test(value))
      );
    case 'integer':
      return (
        Number.isSafeInteger(value) &&
        (value as number) >= (schema.minimum as number) &&
        (value as number) <= (schema.maximum as number)
      );
    case 'array':
      return (
        Array.isArray(value) &&
        value.length <= (schema.maxItems as number) &&
        value.every((item) =>
          validates(item, schema.items as Record<string, unknown>),
        )
      );
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
      const fields = schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      return (
        (schema.required as string[]).every((key) =>
          Object.hasOwn(value, key),
        ) &&
        Object.entries(value).every(
          ([key, field]) =>
            Object.hasOwn(fields, key) && validates(field, fields[key]),
        )
      );
    }
    default:
      return false;
  }
}
export const isPlanningTool = (name: string) =>
  planningTools.some((tool) => tool.name === name);
export function validPlanningArguments(
  name: string,
  args: Record<string, unknown>,
) {
  const tool = planningTools.find((tool) => tool.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callPlanningTool(
  name: string,
  args: Record<string, unknown>,
  actor: string,
) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const projects = await import('@/lib/services/projects');
    const milestones = await import('@/lib/services/milestones');
    const p = args.projectId as string,
      id = args.id as string,
      key = args.requestKey as string,
      rev = args.expectedRevision as number;
    let result: unknown;
    switch (name) {
      case 'projects_list':
        result = await projects.listProjects(actor, args);
        break;
      case 'projects_get':
        result = await projects.getProject(actor, id);
        break;
      case 'projects_register':
        result = await projects.registerProject(actor, args as never, key);
        break;
      case 'projects_update': {
        const {
          id: _id,
          expectedRevision: _rev,
          requestKey: _key,
          ...config
        } = args;
        result = await projects.updateProject(
          actor,
          id,
          config as never,
          rev,
          key,
        );
        break;
      }
      case 'milestones_list':
        result = await milestones.listMilestones(actor, p, args);
        break;
      case 'milestones_get':
        result = await milestones.getMilestone(actor, p, id);
        break;
      case 'milestones_create':
        result = await milestones.createMilestone(
          actor,
          p,
          {
            title: args.title as string,
            description: args.description as string | undefined,
          },
          key,
        );
        break;
      case 'milestones_update':
        result = await milestones.updateMilestone(
          actor,
          p,
          id,
          {
            title: args.title as string,
            description: args.description as string | undefined,
          },
          rev,
          key,
        );
        break;
      case 'milestones_move':
        result = await milestones.moveMilestone(
          actor,
          p,
          id,
          args.beforeId as string | null,
          args.expectedPlanningRevision as number,
          key,
        );
        break;
      default:
        throw new PlanningError('validation', 'Unbekanntes Planungswerkzeug.');
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const failure =
      error instanceof PlanningError
        ? { code: error.code, error: error.message }
        : {
            code: 'unavailable',
            error: 'Die Projektplanung ist vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
