import { validates } from './schema';
const str = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
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
const entity = { projectId: id, id };
const key = { ...str(128), pattern: '^[A-Za-z0-9._:-]+$' };
const proof = obj({
  number: int(1, 18),
  kind: choice('sites-proof', 'public-git'),
  implementationCommit: nullable(sha),
  integrationCommit: nullable(sha),
  prUrl: nullable(str(1000)),
  ciUrl: nullable(str(1000)),
  sourceCommit: sha,
  verificationReference: str(1000),
  verifiedAt: str(64),
});
type Args = Record<string, unknown>;
type Definition = {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof obj>;
  group: 'bootstrap';
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
  group: Definition['group'] = 'bootstrap',
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
const detailArgs = (actor: string, a: Args) => [actor, a.projectId, a.id];
const definitions: Definition[] = [
  define(
    'bootstrap_status',
    'Liest den Installationsstand des festen Luufi-Neustartmanifests 1–18.',
    {},
    [],
    'getBootstrapStatus',
    (actor) => [actor],
    true,
    'bootstrap',
  ),
  define(
    'bootstrap_reconcile',
    'Gleicht ausschließlich das freigegebene feste Luufi-Manifest mit 18 tatsächlichen Git-/Sites-Belegen ab. Kein allgemeiner Import.',
    {
      proofs: array(proof, 18),
      confirmationReference: str(1000),
      requestKey: key,
    },
    ['proofs', 'confirmationReference', 'requestKey'],
    'reconcileBootstrap',
    (actor, a) => [actor, a.proofs, a.confirmationReference, a.requestKey],
    false,
    'bootstrap',
  ),
  define(
    'orders_bootstrap_provenance',
    'Liest den getrennten historischen Bootstrapbeleg eines Auftrags.',
    entity,
    ['projectId', 'id'],
    'getOrderBootstrapProvenance',
    detailArgs,
    true,
    'bootstrap',
  ),
];
export const bootstrapTools = definitions.map(
  ({ group: _group, method: _method, args: _args, ...tool }) => tool,
);
export const isBootstrapTool = (name: string) =>
  definitions.some((t) => t.name === name);
export function validBootstrapArguments(name: string, args: Args) {
  const tool = definitions.find((t) => t.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callBootstrapTool(
  name: string,
  args: Args,
  actor: string,
) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const tool = definitions.find((t) => t.name === name);
    if (!tool)
      throw new PlanningError('validation', 'Unbekanntes Bootstrapwerkzeug.');
    const service: Record<string, unknown> =
      await import('@/lib/services/bootstrap');
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
            error:
              'Versionen und Bootstrap sind vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
