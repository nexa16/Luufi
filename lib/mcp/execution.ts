import { validates } from './schema';
const str = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
const text = { type: 'string', maxLength: 4000 };
const int = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: 'integer',
  minimum,
  maximum,
});
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
});
const array = (items: Record<string, unknown>, maxItems = 50) => ({
  type: 'array',
  items,
  maxItems,
});
const id = str(),
  revision = int(),
  requestKey = { ...str(128), pattern: '^[A-Za-z0-9._:-]+$' };
const entity = { projectId: id, id };
const mutation = { ...entity, expectedRevision: revision, requestKey };
const page = { limit: int(1, 50), cursor: str(2048) };
const reason = obj({ reason: str(4000), reference: str(1000) });
const execution = { executionId: id, generation: int(1) };
const action = obj(
  { ...execution, reason: str(4000), reference: str(1000), worker: str(200) },
  ['executionId', 'generation', 'reason', 'reference'],
);
const progress = {
  kind: { type: 'string', enum: ['update', 'obstacle', 'test', 'handover'] },
  text: str(4000),
  nextAction: text,
};
const sha = { ...str(40), pattern: '^[0-9a-fA-F]{40}$' };
const observation = obj({
  repository: str(1000),
  branch: str(200),
  remoteRef: str(1000),
  headSha: sha,
  commitSha: sha,
  observedAt: str(64),
  source: { type: 'string', enum: ['codex-local-git'] },
  commitSubject: str(1000),
  parentShas: array(sha, 10),
  ancestorOfHead: { type: 'boolean' },
  pushed: { type: 'boolean' },
  pr: nullable(
    obj({
      url: str(1000),
      baseBranch: str(200),
      headSha: sha,
      merged: { type: 'boolean' },
      mergeSha: nullable(sha),
      normalMerge: { type: 'boolean' },
    }),
  ),
  ci: array(
    obj({
      url: str(1000),
      name: str(200),
      headSha: sha,
      conclusion: {
        type: 'string',
        enum: ['success', 'failure', 'cancelled', 'pending'],
      },
    }),
  ),
});
const evidence = obj(
  {
    ...execution,
    outcome: { type: 'string', enum: ['success', 'failure', 'unavailable'] },
    commitSha: sha,
    summary: str(4000),
    criteria: array(
      obj({
        id: str(64),
        result: { type: 'string', enum: ['pass', 'fail', 'manual-only'] },
        reference: str(1000),
      }),
    ),
    documentationReference: { type: 'string', maxLength: 1000 },
    observation: nullable(observation),
    validationId: id,
    unavailableBuildReason: text,
    supersedesId: id,
  },
  [
    'executionId',
    'generation',
    'outcome',
    'commitSha',
    'summary',
    'criteria',
    'documentationReference',
    'observation',
  ],
);
type Args = Record<string, unknown>;
type Group = 'lifecycle' | 'execution' | 'evidence';
type Definition = {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof obj>;
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  group: Group;
  method: string;
  args: (actor: string, a: Args) => unknown[];
};
function define(
  name: string,
  description: string,
  properties: Args,
  required: string[],
  group: Group,
  method: string,
  args: Definition['args'],
  readOnly = false,
): Definition {
  return {
    name,
    description,
    inputSchema: obj(properties, required),
    annotations: {
      readOnlyHint: readOnly,
      openWorldHint: false,
      ...(!readOnly ? { destructiveHint: false, idempotentHint: true } : {}),
    },
    group,
    method,
    args,
  };
}
const read = (actor: string, a: Args) => [
  actor,
  a.projectId,
  a.id,
  { limit: a.limit, cursor: a.cursor },
];
const mutate = (actor: string, a: Args) => [
  actor,
  a.projectId,
  a.id,
  a.input,
  a.expectedRevision,
  a.requestKey,
];
const simple = (actor: string, a: Args) => [
  actor,
  a.projectId,
  a.id,
  a.expectedRevision,
  a.requestKey,
];
const definitions = [
  define(
    'orders_mark_ready',
    'Prüft die aktuelle Fassung und setzt bereit, ohne Umsetzung freizugeben.',
    mutation,
    Object.keys(mutation),
    'lifecycle',
    'markOrderReady',
    simple,
  ),
  define(
    'orders_return_to_draft',
    'Gibt eine bereite Fassung ausdrücklich zurück und entwertet ihre Freigabe.',
    { ...mutation, input: reason },
    [...Object.keys(mutation), 'input'],
    'lifecycle',
    'returnOrderToDraft',
    mutate,
  ),
  define(
    'orders_archive',
    'Archiviert einen nicht laufenden Auftrag mit dokumentiertem Grund.',
    { ...mutation, input: reason },
    [...Object.keys(mutation), 'input'],
    'lifecycle',
    'archiveOrder',
    mutate,
  ),
  define(
    'approvals_create',
    'Speichert die konkrete Nutzerfreigabe genauer Fassungen. Startet keine Arbeit.',
    {
      projectId: id,
      input: obj(
        {
          mode: { type: 'string', enum: ['selection', 'milestone'] },
          orderIds: array(id),
          milestoneId: id,
          confirmationReference: str(1000),
        },
        ['mode', 'confirmationReference'],
      ),
      expectedPlanningRevision: revision,
      requestKey,
    },
    ['projectId', 'input', 'expectedPlanningRevision', 'requestKey'],
    'lifecycle',
    'recordApproval',
    (actor, a) => [
      actor,
      a.projectId,
      a.input,
      a.expectedPlanningRevision,
      a.requestKey,
    ],
  ),
  define(
    'approvals_revoke',
    'Widerruft eine noch nicht laufende Freigabe mit Grund und Nutzerreferenz.',
    { ...mutation, input: reason },
    [...Object.keys(mutation), 'input'],
    'lifecycle',
    'revokeApproval',
    mutate,
  ),
  define(
    'approvals_items',
    'Liest den vollständigen Freigabesnapshot seitenweise.',
    { ...entity, ...page },
    Object.keys(entity),
    'lifecycle',
    'listApprovalItems',
    read,
    true,
  ),
  define(
    'orders_approvals',
    'Liest gültige und historische Freigaben eines Auftrags.',
    { ...entity, ...page },
    Object.keys(entity),
    'lifecycle',
    'listOrderApprovals',
    read,
    true,
  ),
  define(
    'orders_lifecycle',
    'Liest aktuelle Freigabe, Bearbeitung und Nachweisreferenzen.',
    entity,
    Object.keys(entity),
    'lifecycle',
    'getOrderLifecycle',
    (actor, a) => [actor, a.projectId, a.id],
    true,
  ),
  define(
    'orders_progress',
    'Liest datierte Fortschritts- und Hindernisnotizen.',
    { ...entity, ...page },
    Object.keys(entity),
    'execution',
    'listOrderProgress',
    read,
    true,
  ),
  define(
    'orders_events',
    'Liest die unveränderliche Historie der Zustandsübergänge.',
    { ...entity, ...page },
    Object.keys(entity),
    'lifecycle',
    'listLifecycleEvents',
    read,
    true,
  ),
  define(
    'orders_start',
    'Beginnt genau eine ausdrücklich freigegebene Fassung mit exklusivem Claim.',
    {
      ...mutation,
      input: obj({
        approvalId: id,
        worker: str(200),
        branch: str(200),
        prerequisiteCheck: str(4000),
      }),
    },
    [...Object.keys(mutation), 'input'],
    'execution',
    'startExecution',
    mutate,
  ),
  ...(
    [
      [
        'orders_pause',
        'Unterbricht die Bearbeitung bei gesperrter Fassung.',
        'pauseExecution',
      ],
      [
        'orders_resume',
        'Setzt unveränderte Arbeit nach dokumentierter Nutzeraufforderung fort.',
        'resumeExecution',
      ],
      [
        'orders_takeover',
        'Dokumentiert die ausdrückliche Übernahme mit neuer Generation.',
        'takeOverExecution',
      ],
      [
        'orders_stop',
        'Stoppt ausdrücklich zur Neuplanung, beendet Claim und alte Freigabe.',
        'stopForReplan',
      ],
    ] as const
  ).map(([name, description, method]) =>
    define(
      name,
      description,
      { ...mutation, input: action },
      [...Object.keys(mutation), 'input'],
      'execution',
      method,
      mutate,
    ),
  ),
  define(
    'orders_progress_append',
    'Ergänzt Fortschritt; Hindernisse benötigen eine nächste Aktion.',
    { ...mutation, input: obj({ ...execution, ...progress }) },
    [...Object.keys(mutation), 'input'],
    'execution',
    'appendOrderProgress',
    mutate,
  ),
  define(
    'milestones_close',
    'Schließt erfüllte Milestones; leere nur nach ausdrücklicher Bestätigung.',
    { ...mutation, input: obj({ confirmEmpty: { type: 'boolean' } }) },
    [...Object.keys(mutation), 'input'],
    'lifecycle',
    'closeMilestone',
    mutate,
  ),
  ...(
    [
      [
        'orders_validation_record',
        'Dokumentiert tatsächlich von Codex beobachtete Kriterien- und Dokumentationsprüfung.',
        'recordValidation',
      ],
      [
        'orders_implementation_record',
        'Speichert den geprüften gepushten Auftragscommit und setzt implementiert.',
        'recordImplementation',
      ],
      [
        'orders_integration_record',
        'Speichert nachgewiesenen normalen PR-Merge und schließt Auftrag atomar ab.',
        'recordIntegration',
      ],
    ] as const
  ).map(([name, description, method]) =>
    define(
      name,
      description,
      { ...mutation, input: evidence },
      [...Object.keys(mutation), 'input'],
      'evidence',
      method,
      mutate,
    ),
  ),
  define(
    'orders_evidence',
    'Liest aufgezeichnete Prüf-, Implementierungs- und Integrationsnachweise.',
    { ...entity, ...page },
    Object.keys(entity),
    'evidence',
    'listOrderEvidence',
    read,
    true,
  ),
];
export const executionTools = definitions.map(
  ({ group: _group, method: _method, args: _args, ...tool }) => tool,
);
export const isExecutionTool = (name: string) =>
  definitions.some((t) => t.name === name);
export function validExecutionArguments(name: string, args: Args) {
  const tool = definitions.find((t) => t.name === name);
  return !!tool && validates(args, tool.inputSchema);
}
export async function callExecutionTool(
  name: string,
  args: Args,
  actor: string,
) {
  const { PlanningError } = await import('@/lib/services/planning-store');
  try {
    const tool = definitions.find((t) => t.name === name);
    if (!tool)
      throw new PlanningError('validation', 'Unbekanntes Ausführungswerkzeug.');
    const service: Record<string, unknown> =
      tool.group === 'lifecycle'
        ? await import('@/lib/services/order-lifecycle')
        : tool.group === 'execution'
          ? await import('@/lib/services/order-execution')
          : await import('@/lib/services/order-evidence');
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
            error: 'Die Auftragsausführung ist vorübergehend nicht verfügbar.',
          };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(failure) }],
    };
  }
}
