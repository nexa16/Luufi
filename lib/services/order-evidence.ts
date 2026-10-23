import { getD1 } from '@/lib/data/d1';
import type {
  Evidence,
  EvidenceInput,
  GitObservation,
} from '@/lib/domain/execution';
import type { OrderSpec, Page, PageOptions } from '@/lib/domain/planning';
import {
  approvalValid,
  evidenceJson,
  reconcileMilestones,
} from './execution-sql';
import {
  authorizePlanning,
  expectedRevision,
  planningAttempt,
  planningId,
  planningMutation,
  planningPage,
  planningStorage,
  planningText,
  PlanningError,
  sql,
} from './planning-store';

const invalid = (message = 'Der Nachweis ist ungültig.'): never => {
  throw new PlanningError('validation', message);
};
const conflict = (
  message = 'Der Auftrag, die Bearbeitung oder der Nachweis wurde inzwischen geändert.',
): never => {
  throw new PlanningError('conflict', message);
};
function object(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
}
const text = (value: unknown, name: string, max = 4000, required = true) =>
  planningText(value, name, max, required);
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value))
    invalid('Ein vollständiger 40-stelliger Git-SHA ist erforderlich.');
  return (value as string).toLowerCase();
}
function branch(value: unknown, max = 200) {
  const s = text(value, 'Branch', max);
  if (
    Array.from(s).some(
      (c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127,
    ) ||
    s.startsWith('-')
  )
    invalid();
  return s;
}
function url(value: unknown) {
  const s = text(value, 'Link', 1000);
  try {
    const u = new URL(s);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
      invalid();
  } catch {
    invalid('Der Nachweislink muss ein sicherer HTTP(S)-Link sein.');
  }
  return s;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value as boolean;
}
function observation(value: unknown): GitObservation | null {
  if (value === null) return null;
  object(value, [
    'repository',
    'branch',
    'remoteRef',
    'headSha',
    'commitSha',
    'observedAt',
    'source',
    'commitSubject',
    'parentShas',
    'ancestorOfHead',
    'pushed',
    'pr',
    'ci',
  ]);
  if (value.source !== 'codex-local-git')
    invalid(
      'Der Nachweis muss als lokale Codex-Gitprüfung gekennzeichnet sein.',
    );
  const observedAt = text(value.observedAt, 'Prüfzeit', 40);
  if (
    !/^\d{4}-\d\d-\d\dT/.test(observedAt) ||
    !Number.isFinite(Date.parse(observedAt))
  )
    invalid();
  if (
    !Array.isArray(value.parentShas) ||
    value.parentShas.length > 8 ||
    !Array.isArray(value.ci) ||
    value.ci.length > 50
  )
    invalid();
  let pr: GitObservation['pr'] = null;
  if (value.pr !== null) {
    object(value.pr, [
      'url',
      'baseBranch',
      'headSha',
      'merged',
      'mergeSha',
      'normalMerge',
    ]);
    pr = {
      url: url(value.pr.url),
      baseBranch: branch(value.pr.baseBranch),
      headSha: sha(value.pr.headSha),
      merged: bool(value.pr.merged),
      mergeSha: value.pr.mergeSha === null ? null : sha(value.pr.mergeSha),
      normalMerge: bool(value.pr.normalMerge),
    };
  }
  return {
    repository: text(value.repository, 'Repository', 1000),
    branch: branch(value.branch),
    remoteRef: branch(value.remoteRef, 1000),
    headSha: sha(value.headSha),
    commitSha: sha(value.commitSha),
    observedAt,
    source: 'codex-local-git',
    commitSubject: text(value.commitSubject, 'Commitbetreff', 1000),
    parentShas: (value.parentShas as unknown[]).map(sha),
    ancestorOfHead: bool(value.ancestorOfHead),
    pushed: bool(value.pushed),
    pr,
    ci: (value.ci as unknown[]).map((item) => {
      object(item, ['url', 'name', 'headSha', 'conclusion']);
      if (
        !['success', 'failure', 'cancelled', 'pending'].includes(
          item.conclusion as string,
        )
      )
        invalid();
      return {
        url: url(item.url),
        name: text(item.name, 'CI-Name', 200),
        headSha: sha(item.headSha),
        conclusion:
          item.conclusion as GitObservation['ci'][number]['conclusion'],
      };
    }),
  };
}
function normalize(input: EvidenceInput) {
  object(input, [
    'outcome',
    'executionId',
    'generation',
    'commitSha',
    'summary',
    'criteria',
    'documentationReference',
    'observation',
    'validationId',
    'unavailableBuildReason',
    'supersedesId',
  ]);
  if (
    !['success', 'failure', 'unavailable'].includes(input.outcome) ||
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1 ||
    !Array.isArray(input.criteria) ||
    input.criteria.length > 50
  )
    invalid();
  planningId(input.executionId);
  const criteria = input.criteria
    .map((item) => {
      object(item, ['id', 'result', 'reference']);
      if (!['pass', 'fail', 'manual-only'].includes(item.result)) invalid();
      return {
        id: text(item.id, 'Kriterienkennung', 64),
        result: item.result,
        reference: text(item.reference, 'Kriteriennachweis', 1000),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(criteria.map((c) => c.id)).size !== criteria.length)
    invalid('Kriterienkennungen müssen eindeutig sein.');
  if (input.validationId !== undefined) planningId(input.validationId);
  if (input.supersedesId !== undefined) planningId(input.supersedesId);
  return {
    outcome: input.outcome,
    executionId: input.executionId,
    generation: input.generation,
    commitSha: sha(input.commitSha),
    summary: text(input.summary, 'Zusammenfassung'),
    criteria,
    documentationReference: text(
      input.documentationReference,
      'Dokumentationsnachweis',
      1000,
      input.outcome === 'success',
    ),
    observation: observation(input.observation),
    validationId: input.validationId ?? null,
    unavailableBuildReason: text(
      input.unavailableBuildReason ?? '',
      'Fehlende Bereitstellung',
      4000,
      false,
    ),
    supersedesId: input.supersedesId ?? null,
  };
}
type State = {
  id: string;
  project_id: string;
  number: number;
  status: string;
  spec_version: number;
  revision: number;
  lifecycle_revision: number;
  current_implementation_id: string | null;
  integration_id: string | null;
  project_key: string;
  repository: string;
  integration_branch: string;
  spec_json: string;
  claim_id: string | null;
  generation: number | null;
  phase: string | null;
  claim_spec: number | null;
  branch: string | null;
  valid_approval: number | null;
};
async function state(projectId: string, id: string): Promise<State> {
  const row = await getD1()
    .prepare(
      `SELECT o.*,p.project_key,p.repository,p.integration_branch,v.spec_json,e.id AS claim_id,e.generation,e.phase,e.spec_version AS claim_spec,e.branch,(SELECT ${approvalValid()} FROM order_approvals a JOIN order_approval_items i ON i.approval_id=a.id WHERE a.id=e.approval_id AND i.order_id=o.id) AS valid_approval FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id JOIN planning_order_versions v ON v.order_id=o.id AND v.version=o.spec_version LEFT JOIN order_executions e ON e.order_id=o.id AND e.phase IN ('active','paused') WHERE o.project_id=? AND o.id=?`,
    )
    .bind(projectId, id)
    .first<State>();
  if (!row)
    throw new PlanningError('not_found', 'Der Auftrag wurde nicht gefunden.');
  return row;
}
function scope(actor: string, projectId: string, id: string) {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
}
async function evidence(id: string): Promise<Evidence | null> {
  const row = await getD1()
    .prepare(
      `SELECT ${evidenceJson()} AS data FROM order_evidence e WHERE e.id=?`,
    )
    .bind(id)
    .first<{ data: string }>();
  return row ? JSON.parse(row.data) : null;
}
async function record(
  kind: Evidence['kind'],
  actor: string,
  projectId: string,
  id: string,
  input: EvidenceInput,
  revision: number,
  key: string,
): Promise<Evidence> {
  scope(actor, projectId, id);
  expectedRevision(revision);
  const value = normalize(input),
    payload = { projectId, id, expectedRevision: revision, ...value };
  return planningAttempt(
    actor,
    `orders.evidence.${kind}`,
    payload,
    key,
    async () => {
      const order = await state(projectId, id),
        success = value.outcome === 'success';
      if (
        order.revision !== revision ||
        !['implementing', 'implemented'].includes(order.status) ||
        order.claim_id !== value.executionId ||
        order.generation !== value.generation ||
        order.claim_spec !== order.spec_version ||
        !['active', 'paused'].includes(order.phase ?? '') ||
        (success && (order.phase !== 'active' || !order.valid_approval))
      )
        conflict();
      const spec = JSON.parse(order.spec_json) as OrderSpec;
      const criterionIds = spec.criteria.map((c) => c.id).sort();
      if (
        JSON.stringify(criterionIds) !==
        JSON.stringify(value.criteria.map((c) => c.id).sort())
      )
        invalid(
          'Der Nachweis muss jedes aktuelle Akzeptanzkriterium genau einmal enthalten.',
        );
      if (success && value.criteria.some((c) => c.result === 'fail'))
        invalid(
          'Ein erfolgreicher Nachweis darf keine fehlgeschlagenen Kriterien enthalten.',
        );
      if (value.supersedesId && (kind !== 'implementation' || !success))
        invalid(
          'Nur ein erfolgreicher Implementierungskandidat darf einen Vorgänger ersetzen.',
        );
      if (kind === 'validation' && value.validationId) invalid();
      const linkedValidation = value.validationId
        ? await evidence(value.validationId)
        : null;
      if (
        value.validationId &&
        (!linkedValidation ||
          linkedValidation.kind !== 'validation' ||
          linkedValidation.orderId !== id ||
          linkedValidation.specVersion !== order.spec_version ||
          linkedValidation.executionId !== value.executionId ||
          linkedValidation.generation !== value.generation ||
          linkedValidation.commitSha !== value.commitSha)
      )
        invalid(
          'Die verknüpfte Kriterienprüfung gehört nicht zu diesem Auftrag, Commit und dieser Bearbeitung.',
        );
      const observed = value.observation;
      if (
        observed &&
        (observed.repository !== order.repository ||
          observed.commitSha !== value.commitSha)
      )
        invalid(
          'Die Gitbeobachtung muss zu Repository und Commit des Nachweises gehören.',
        );
      if (success && kind !== 'validation') {
        if (
          !observed ||
          observed.repository !== order.repository ||
          observed.commitSha !== value.commitSha ||
          !observed.pushed ||
          !observed.ancestorOfHead
        )
          invalid(
            'Ein passender gepushter und im Branch enthaltener Gitcommit ist erforderlich.',
          );
        const displayId = `${order.project_key}-${order.number}`;
        const escaped = displayId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (
          !new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`).test(
            observed!.commitSubject,
          ) ||
          observed!.parentShas.length > 1
        )
          invalid(
            'Der finale Auftragscommit muss die richtige Auftragskennung tragen und darf kein Mergecommit sein.',
          );
      }
      if (success && kind === 'implementation') {
        if (
          observed!.branch !== order.branch ||
          !observed!.remoteRef.endsWith(`/${order.branch}`)
        )
          invalid('Der Gitnachweis gehört nicht zum aktuellen Arbeitsbranch.');
        if (order.current_implementation_id !== value.supersedesId)
          conflict(
            'Ein vorhandener Kandidat muss ausdrücklich mit seiner aktuellen Nachweiskennung ersetzt werden.',
          );
        const validation = linkedValidation;
        if (
          !validation ||
          validation.kind !== 'validation' ||
          validation.outcome !== 'success' ||
          validation.orderId !== id ||
          validation.specVersion !== order.spec_version ||
          validation.executionId !== value.executionId ||
          validation.generation !== value.generation ||
          validation.commitSha !== value.commitSha ||
          !validation.documentationReference
        )
          invalid(
            'Eine erfolgreiche Kriterien- und Dokumentationsprüfung desselben Commits und derselben Bearbeitung ist erforderlich.',
          );
      }
      if (success && kind === 'integration') {
        if (order.status !== 'implemented' || !order.current_implementation_id)
          conflict(
            'Vor der Integration ist ein aktueller Implementierungsnachweis erforderlich.',
          );
        const implementation = await evidence(order.current_implementation_id!);
        if (
          !implementation ||
          implementation.outcome !== 'success' ||
          implementation.commitSha !== value.commitSha ||
          implementation.specVersion !== order.spec_version ||
          implementation.executionId !== value.executionId ||
          implementation.generation !== value.generation
        )
          conflict(
            'Die Integration muss den aktuellen Implementierungskandidaten erhalten.',
          );
        if (
          value.validationId &&
          value.validationId !== implementation!.validationId
        )
          invalid('Die Integration verweist auf eine andere Kriterienprüfung.');
        const pr = observed!.pr,
          ci = observed!.ci.filter((c) => c.headSha === pr?.headSha);
        if (
          observed!.branch !== order.integration_branch ||
          !observed!.remoteRef.endsWith(`/${order.integration_branch}`) ||
          !pr?.merged ||
          !pr.normalMerge ||
          !pr.mergeSha ||
          pr.baseBranch !== order.integration_branch ||
          !ci.length ||
          ci.some((c) => c.conclusion !== 'success')
        )
          invalid(
            'Integration erfordert normalen PR-Merge im Integrationsbranch und vollständig erfolgreiche aktuelle PR-CI.',
          );
        if (!value.unavailableBuildReason)
          invalid(
            'Eine fehlende Bereitstellung benötigt einen ausdrücklichen Grund.',
          );
      }
      const evidenceId = crypto.randomUUID(),
        eventId = crypto.randomUUID(),
        now = new Date().toISOString();
      const next =
        success && kind === 'implementation'
          ? 'implemented'
          : success && kind === 'integration'
            ? 'done'
            : order.status;
      return planningMutation<Evidence>({
        actor,
        operation: `orders.evidence.${kind}`,
        payload,
        key,
        guard: sql(
          `EXISTS(SELECT 1 FROM planning_orders o JOIN order_executions e ON e.order_id=o.id WHERE o.project_id=? AND o.id=? AND o.revision=? AND o.status=? AND o.spec_version=? AND e.id=? AND e.generation=? AND e.spec_version=o.spec_version AND e.phase=? ${success ? `AND EXISTS(SELECT 1 FROM order_approvals a JOIN order_approval_items i ON i.approval_id=a.id WHERE a.id=e.approval_id AND i.order_id=o.id AND ${approvalValid()})` : ''})`,
          projectId,
          id,
          revision,
          order.status,
          order.spec_version,
          value.executionId,
          value.generation,
          order.phase!,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO order_evidence(id,order_id,spec_version,kind,outcome,execution_id,generation,payload_json,supersedes_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
            evidenceId,
            id,
            order.spec_version,
            kind,
            value.outcome,
            value.executionId,
            value.generation,
            JSON.stringify(value),
            value.supersedesId,
            now,
            ...gate.params!,
          ),
          sql(
            `UPDATE planning_orders SET revision=revision+1,lifecycle_revision=lifecycle_revision+1,status=?,current_implementation_id=CASE WHEN ? THEN ? ELSE current_implementation_id END,integration_id=CASE WHEN ? THEN ? ELSE integration_id END WHERE id=? AND ${gate.sql}`,
            next,
            Number(success && kind === 'implementation'),
            evidenceId,
            Number(success && kind === 'integration'),
            evidenceId,
            id,
            ...gate.params!,
          ),
          ...(next !== order.status
            ? [
                sql(
                  `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND ${gate.sql}`,
                  projectId,
                  ...gate.params!,
                ),
                sql(
                  `INSERT INTO order_lifecycle_events(id,order_id,spec_version,actor,previous_status,next_status,reason,reference,details_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
                  eventId,
                  id,
                  order.spec_version,
                  actor,
                  order.status,
                  next,
                  value.summary,
                  evidenceId,
                  JSON.stringify({
                    evidenceId,
                    kind,
                    commitSha: value.commitSha,
                  }),
                  now,
                  ...gate.params!,
                ),
              ]
            : []),
          ...(success && kind === 'integration'
            ? [
                sql(
                  `UPDATE order_executions SET phase='closed',revision=revision+1,updated_at=? WHERE id=? AND generation=? AND ${gate.sql}`,
                  now,
                  value.executionId,
                  value.generation,
                  ...gate.params!,
                ),
                ...reconcileMilestones(gate, projectId),
              ]
            : []),
        ],
        result: sql(
          `SELECT ${evidenceJson()} FROM order_evidence e WHERE e.id=?`,
          evidenceId,
        ),
      });
    },
  );
}
export const recordValidation = (
  actor: string,
  p: string,
  id: string,
  input: EvidenceInput,
  revision: number,
  key: string,
) => record('validation', actor, p, id, input, revision, key);
export const recordImplementation = (
  actor: string,
  p: string,
  id: string,
  input: EvidenceInput,
  revision: number,
  key: string,
) => record('implementation', actor, p, id, input, revision, key);
export const recordIntegration = (
  actor: string,
  p: string,
  id: string,
  input: EvidenceInput,
  revision: number,
  key: string,
) => record('integration', actor, p, id, input, revision, key);
export async function listOrderEvidence(
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<Evidence>> {
  scope(actor, p, id);
  return planningStorage(async () => {
    const order = await state(p, id),
      page = planningPage(
        options,
        { kind: 'order-evidence', projectId: p, id },
        order.lifecycle_revision,
      );
    const rows = await getD1()
      .prepare(
        `SELECT ${evidenceJson()} AS data FROM order_evidence e WHERE e.order_id=? ORDER BY e.created_at,e.rowid LIMIT ? OFFSET ?`,
      )
      .bind(id, page.limit + 1, page.offset)
      .all<{ data: string }>();
    const latest = await state(p, id);
    if (latest.lifecycle_revision !== order.lifecycle_revision)
      conflict('Die Nachweisliste wurde geändert. Bitte beginne erneut.');
    return {
      items: rows.results
        .slice(0, page.limit)
        .map((row) => JSON.parse(row.data)),
      nextCursor: page.next(rows.results.length > page.limit),
    };
  });
}
