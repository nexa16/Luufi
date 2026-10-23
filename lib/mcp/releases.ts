import { validates } from './schema';

const str = (maxLength = 256, minLength = 1) => ({
  type: 'string',
  minLength,
  maxLength,
});
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: 'object', properties, required, additionalProperties: false });
const int = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: 'integer',
  minimum,
  maximum,
});
const choice = (...values: string[]) => ({ type: 'string', enum: values });
const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
});
const array = (items: Record<string, unknown>, maxItems = 50) => ({
  type: 'array',
  items,
  maxItems,
});
const sha = { ...str(40), pattern: '^[0-9a-fA-F]{40}$' };
const id = str();
const key = { ...str(128), pattern: '^[A-Za-z0-9._:-]+$' };
const page = { limit: int(1, 50), cursor: str(2048) };
const entity = { projectId: id, id };
const mutation = { ...entity, expectedRevision: int(), requestKey: key };
const versionInput = obj({
  label: str(80),
  channel: choice('develop', 'production'),
  title: str(280),
  changelog: str(20000),
  repositoryCommit: sha,
  sourceBranch: str(200),
  scope: obj(
    {
      mode: choice('selection', 'milestone'),
      orderIds: array(id),
      milestoneId: id,
    },
    ['mode'],
  ),
});
const buildInput = obj({
  kind: choice('site', 'apk'),
  outcome: choice('available', 'unavailable', 'failure'),
  url: nullable(str(1000)),
  reason: str(4000, 0),
  environment: choice('preview', 'production'),
  projectCommit: sha,
  sourceKind: choice('github', 'sites'),
  sourceBranch: str(200),
  sourceCommit: sha,
  versionCommitIncluded: { type: 'boolean' },
  mappingReference: str(1000, 0),
  observedAt: str(64),
  verificationReference: str(1000),
});
const releaseInput = obj({
  confirmationReference: str(1000),
  productionBranch: str(200),
  productionCommit: sha,
  tag: str(200),
  tagCommit: sha,
  buildId: id,
  deploymentReference: str(1000),
  observation: obj({
    repository: str(1000),
    productionBranch: str(200),
    productionHead: sha,
    tag: str(200),
    tagCommit: sha,
    versionCommit: sha,
    versionCommitIncluded: { type: 'boolean' },
    observedAt: str(64),
    source: choice('codex-local-git'),
    ci: array(
      obj({
        url: str(1000),
        name: str(200),
        headSha: sha,
        conclusion: choice('success', 'failure', 'cancelled', 'pending'),
      }),
    ),
  }),
});
type Args = Record<string, unknown>;
type Definition = {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof obj>;
  group: 'versions';
  method: string;
  args: (actor: string, input: Args) => unknown[];
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: false;
    destructiveHint?: false;
    idempotentHint?: true;
  };
};
function define(
  name: string,
  description: string,
  properties: Args,
  required: string[],
  method: string,
  args: Definition['args'],
  readOnly = true,
  group: Definition['group'] = 'versions',
): Definition {
  return {
    name,
    description,
    inputSchema: obj(properties, required),
    method,
    args,
    group,
    annotations: {
      readOnlyHint: readOnly,
      openWorldHint: false,
      ...(!readOnly
        ? ({ destructiveHint: false, idempotentHint: true } as const)
        : {}),
    },
  };
}
const pageArgs = (actor: string, a: Args) => [
  actor,
  a.projectId,
  { limit: a.limit, cursor: a.cursor },
];
const detailArgs = (actor: string, a: Args) => [actor, a.projectId, a.id];
const memberArgs = (actor: string, a: Args) => [
  ...detailArgs(actor, a),
  { limit: a.limit, cursor: a.cursor },
];
const mutationArgs = (actor: string, a: Args) => [
  ...detailArgs(actor, a),
  a.input,
  a.expectedRevision,
  a.requestKey,
];
const definitions: Definition[] = [
  define(
    'versions_create',
    'Speichert eine unveränderliche Projektversion aus nachweislich integrierten Aufträgen. Kein Deployment.',
    {
      projectId: id,
      input: versionInput,
      expectedPlanningRevision: int(),
      requestKey: key,
    },
    ['projectId', 'input', 'expectedPlanningRevision', 'requestKey'],
    'createProjectVersion',
    (actor, a) => [
      actor,
      a.projectId,
      a.input,
      a.expectedPlanningRevision,
      a.requestKey,
    ],
    false,
  ),
  define(
    'versions_list',
    'Liest Projektversionen mit Seitennavigation.',
    { projectId: id, ...page },
    ['projectId'],
    'listProjectVersions',
    pageArgs,
  ),
  define(
    'versions_get',
    'Liest eine Projektversion und ihre aktuelle Belegrevision.',
    entity,
    ['projectId', 'id'],
    'getProjectVersion',
    detailArgs,
  ),
  define(
    'versions_orders',
    'Liest den unveränderlichen Auftragsumfang einer Version.',
    { ...entity, ...page },
    ['projectId', 'id'],
    'listVersionOrders',
    memberArgs,
  ),
  define(
    'versions_builds',
    'Liest datierte Site-/APK-Verfügbarkeitsbeobachtungen.',
    { ...entity, ...page },
    ['projectId', 'id'],
    'listVersionBuilds',
    memberArgs,
  ),
  define(
    'versions_releases',
    'Liest geprüfte Produktionsreleasebelege.',
    { ...entity, ...page },
    ['projectId', 'id'],
    'listVersionReleases',
    memberArgs,
  ),
  define(
    'versions_build_record',
    'Zeichnet eine Codex-Buildbeobachtung mit öffentlichem und Hosting-SHA auf. Veröffentlicht nichts.',
    { ...mutation, input: buildInput },
    ['projectId', 'id', 'input', 'expectedRevision', 'requestKey'],
    'recordVersionBuild',
    mutationArgs,
    false,
  ),
  define(
    'versions_release_record',
    'Zeichnet einen ausdrücklich freigegebenen und geprüften Produktionsrelease auf. Führt keinen Release aus.',
    { ...mutation, input: releaseInput },
    ['projectId', 'id', 'input', 'expectedRevision', 'requestKey'],
    'recordVersionRelease',
    mutationArgs,
    false,
  ),
  define(
    'versions_latest_available',
    'Liest die letzte Version mit aktuell beobachtetem verfügbaren Build.',
    { projectId: id },
    ['projectId'],
    'getLatestAvailableVersion',
    (actor, a) => [actor, a.projectId],
  ),
];
export const releaseTools = definitions.map(
  ({ group: _group, method: _method, args: _args, ...tool }) => tool,
);
export const isReleaseTool = (name: string) =>
  definitions.some((t) => t.name === name);
export function validReleaseArguments(name: string, args: Args) {
  const tool = definitions.find((t) => t.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callReleaseTool(name: string, args: Args, actor: string) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const tool = definitions.find((t) => t.name === name);
    if (!tool)
      throw new PlanningError('validation', 'Unbekanntes Versionswerkzeug.');
    const service: Record<string, unknown> =
      await import('@/lib/services/project-versions');
    const method = service[tool.method];
    if (typeof method !== 'function') throw new Error('Unavailable service');
    const value = await method(...tool.args(actor, args));
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (error) {
    const failure =
      error instanceof PlanningError
        ? { code: error.code, error: error.message }
        : {
            code: 'unavailable',
            error: 'Versionen sind vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
