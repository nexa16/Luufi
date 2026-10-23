import { getD1 } from '@/lib/data/d1';
import type {
  Execution,
  LifecycleSummary,
  Progress,
  ProgressInput,
} from '@/lib/domain/execution';
import type { Page, PageOptions } from '@/lib/domain/planning';
import {
  approvalValid,
  executionJson,
  invalidateApprovalItems,
  lifecycleResult,
  progressJson,
} from './execution-sql';
import {
  executionOrder,
  inputFields,
  lifecycleEvent,
  lifecyclePage,
  lifecycleScope,
  orderRevisionQuery,
  touchLifecycle,
} from './order-lifecycle';
import {
  expectedRevision,
  PlanningError,
  planningAttempt,
  planningId,
  planningMutation,
  planningStorage,
  planningText,
  sql,
} from './planning-store';

type StartInput = {
  approvalId: string;
  worker: string;
  branch: string;
  prerequisiteCheck: string;
};
type ControlInput = {
  executionId: string;
  generation: number;
  reason: string;
  reference: string;
  worker?: string;
};
function branchName(value: unknown) {
  const branch = planningText(value, 'Arbeitsbranch', 200, true);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    /\.\.|\/\/|\/$|\.lock$/.test(branch)
  )
    throw new PlanningError('validation', 'Der Arbeitsbranch ist ungültig.');
  return branch;
}
function controlInput(input: ControlInput, takeover: boolean) {
  inputFields(input, [
    'executionId',
    'generation',
    'reason',
    'reference',
    ...(takeover ? ['worker'] : []),
  ]);
  planningId(input.executionId);
  expectedRevision(input.generation);
  if (input.generation < 1)
    throw new PlanningError(
      'validation',
      'Die Bearbeitungsgeneration ist ungültig.',
    );
  return {
    executionId: input.executionId,
    generation: input.generation,
    reason: planningText(input.reason, 'Grund', 4000, true),
    reference: planningText(input.reference, 'Nutzeraufforderung', 1000, true),
    ...(takeover
      ? { worker: planningText(input.worker, 'Neuer Bearbeiter', 200, true) }
      : {}),
  };
}
const authorizedApproval = (p: string, id: string, approvalId: string) =>
  sql(
    `EXISTS(SELECT 1 FROM order_approvals a JOIN order_approval_items i ON i.approval_id=a.id JOIN planning_orders o ON o.id=i.order_id WHERE a.project_id=? AND o.project_id=? AND o.id=? AND a.id=? AND ${approvalValid()})`,
    p,
    p,
    id,
    approvalId,
  );
// Evidence is an owner-authenticated Codex observation, not server-side Git verification.
const prerequisites = (p: string, id: string, branch: string) =>
  sql(
    `NOT EXISTS(SELECT 1 FROM planning_order_relations r JOIN planning_orders d ON d.id=r.target_id WHERE r.source_id=? AND r.type='depends_on' AND (d.project_id<>? OR NOT (d.status='done' OR (d.status='implemented' AND EXISTS(SELECT 1 FROM order_evidence e WHERE e.id=d.current_implementation_id AND e.order_id=d.id AND e.spec_version=d.spec_version AND e.kind='implementation' AND e.outcome='success' AND json_extract(e.payload_json,'$.observation.branch')=? AND json_extract(e.payload_json,'$.observation.repository')=(SELECT repository FROM planning_projects WHERE id=?) AND json_extract(e.payload_json,'$.observation.pushed')=1 AND json_extract(e.payload_json,'$.observation.ancestorOfHead')=1)))))`,
    id,
    p,
    branch,
    p,
  );
async function currentExecution(
  actor: string,
  p: string,
  id: string,
  executionId: string,
): Promise<Execution> {
  await executionOrder(actor, p, id);
  const row = await getD1()
    .prepare(
      `SELECT ${executionJson()} AS data FROM order_executions e WHERE project_id=? AND order_id=? AND id=?`,
    )
    .bind(p, id, executionId)
    .first<{ data: string }>();
  if (!row)
    throw new PlanningError(
      'not_found',
      'Diese Bearbeitung wurde nicht gefunden.',
    );
  return JSON.parse(row.data) as Execution;
}
export async function startExecution(
  actor: string,
  p: string,
  id: string,
  input: StartInput,
  revision: number,
  key: string,
): Promise<LifecycleSummary> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  inputFields(input, ['approvalId', 'worker', 'branch', 'prerequisiteCheck']);
  planningId(input.approvalId);
  const value = {
      approvalId: input.approvalId,
      worker: planningText(input.worker, 'Bearbeiter', 200, true),
      branch: branchName(input.branch),
      prerequisiteCheck: planningText(
        input.prerequisiteCheck,
        'Prüfung der Voraussetzungen',
        4000,
        true,
      ),
    },
    payload = { p, id, ...value, expectedRevision: revision };
  return planningAttempt(actor, 'execution.start', payload, key, async () => {
    await executionOrder(actor, p, id);
    const approved = authorizedApproval(p, id, value.approvalId),
      deps = prerequisites(p, id, value.branch),
      executionId = crypto.randomUUID(),
      now = new Date().toISOString();
    return planningMutation({
      actor,
      operation: 'execution.start',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_orders o WHERE project_id=? AND id=? AND revision=? AND status='ready' AND (milestone_id IS NULL OR EXISTS(SELECT 1 FROM planning_milestones WHERE id=o.milestone_id AND state='open'))) AND NOT EXISTS(SELECT 1 FROM order_executions WHERE order_id=? AND phase IN ('active','paused')) AND (${approved.sql}) AND (${deps.sql})`,
        p,
        id,
        revision,
        id,
        ...approved.params!,
        ...deps.params!,
      ),
      writes: (gate) => [
        sql(
          `INSERT INTO order_executions(id,project_id,order_id,spec_version,approval_id,worker,branch,generation,phase,created_at,updated_at) SELECT ?,project_id,id,spec_version,?,?,?,COALESCE((SELECT MAX(generation) FROM order_executions WHERE order_id=?),0)+1,'active',?,? FROM planning_orders WHERE id=? AND (${gate.sql})`,
          executionId,
          value.approvalId,
          value.worker,
          value.branch,
          id,
          now,
          now,
          id,
          ...gate.params!,
        ),
        lifecycleEvent(
          gate,
          actor,
          p,
          id,
          'implementing',
          value.prerequisiteCheck,
          '',
          {
            action: 'start',
            executionId,
            approvalId: value.approvalId,
            worker: value.worker,
            branch: value.branch,
          },
          now,
        ),
        ...touchLifecycle(gate, p, id, 'implementing'),
      ],
      result: lifecycleResult(p, id),
    });
  });
}
async function executionControl(
  action: 'pause' | 'resume' | 'takeover' | 'stop',
  actor: string,
  p: string,
  id: string,
  input: ControlInput,
  revision: number,
  key: string,
): Promise<LifecycleSummary> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  const value = controlInput(input, action === 'takeover'),
    payload = { p, id, ...value, expectedRevision: revision },
    operation = `execution.${action}`;
  return planningAttempt(actor, operation, payload, key, async () => {
    const execution = await currentExecution(actor, p, id, value.executionId),
      approved = authorizedApproval(p, id, execution.approvalId),
      deps = prerequisites(p, id, execution.branch),
      now = new Date().toISOString();
    const phase =
      action === 'pause'
        ? "e.phase='active'"
        : action === 'resume'
          ? "e.phase='paused'"
          : "e.phase IN ('active','paused')";
    return planningMutation({
      actor,
      operation,
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_orders o JOIN order_executions e ON e.order_id=o.id WHERE o.project_id=? AND o.id=? AND o.revision=? AND o.status IN ('implementing','implemented') AND e.id=? AND e.generation=? AND e.spec_version=o.spec_version AND ${phase}) ${action === 'resume' ? `AND (${approved.sql}) AND (${deps.sql})` : ''}`,
        p,
        id,
        revision,
        value.executionId,
        value.generation,
        ...(action === 'resume' ? [...approved.params!, ...deps.params!] : []),
      ),
      writes: (gate) => [
        lifecycleEvent(
          gate,
          actor,
          p,
          id,
          action === 'stop' ? 'draft' : null,
          value.reason,
          value.reference,
          {
            action,
            executionId: value.executionId,
            generation: value.generation,
            previousWorker: execution.worker,
            previousPhase: execution.phase,
            ...('worker' in value ? { worker: value.worker } : {}),
          },
          now,
        ),
        sql(
          `UPDATE order_executions SET phase=${action === 'pause' ? "'paused'" : action === 'resume' ? "'active'" : action === 'stop' ? "'closed'" : 'phase'},generation=generation+${action === 'takeover' || action === 'stop' ? 1 : 0},worker=COALESCE(?,worker),revision=revision+1,updated_at=? WHERE id=? AND (${gate.sql})`,
          'worker' in value ? value.worker! : null,
          now,
          value.executionId,
          ...gate.params!,
        ),
        ...(action === 'stop'
          ? [
              invalidateApprovalItems(gate, id, value.reason),
              sql(
                `UPDATE planning_orders SET current_implementation_id=NULL,integration_id=NULL WHERE id=? AND (${gate.sql})`,
                id,
                ...gate.params!,
              ),
            ]
          : []),
        ...touchLifecycle(gate, p, id, action === 'stop' ? 'draft' : null),
      ],
      result: lifecycleResult(p, id),
    });
  });
}
export const pauseExecution = (
  actor: string,
  p: string,
  id: string,
  input: ControlInput,
  revision: number,
  key: string,
) => executionControl('pause', actor, p, id, input, revision, key);
export const resumeExecution = (
  actor: string,
  p: string,
  id: string,
  input: ControlInput,
  revision: number,
  key: string,
) => executionControl('resume', actor, p, id, input, revision, key);
export const takeOverExecution = (
  actor: string,
  p: string,
  id: string,
  input: ControlInput,
  revision: number,
  key: string,
) => executionControl('takeover', actor, p, id, input, revision, key);
export const stopForReplan = (
  actor: string,
  p: string,
  id: string,
  input: ControlInput,
  revision: number,
  key: string,
) => executionControl('stop', actor, p, id, input, revision, key);
export async function appendOrderProgress(
  actor: string,
  p: string,
  id: string,
  input: ProgressInput & { executionId: string; generation: number },
  revision: number,
  key: string,
): Promise<Progress> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  inputFields(input, [
    'executionId',
    'generation',
    'kind',
    'text',
    'nextAction',
  ]);
  planningId(input.executionId);
  expectedRevision(input.generation);
  if (
    input.generation < 1 ||
    !['update', 'obstacle', 'test', 'handover'].includes(input.kind)
  )
    throw new PlanningError(
      'validation',
      'Die Fortschrittsangabe ist ungültig.',
    );
  const value = {
      executionId: input.executionId,
      generation: input.generation,
      kind: input.kind,
      text: planningText(input.text, 'Fortschritt', 4000, true),
      nextAction: planningText(
        input.nextAction === undefined ? '' : input.nextAction,
        'Nächste Aktion',
        4000,
        input.kind === 'obstacle',
      ),
    },
    payload = { p, id, ...value, expectedRevision: revision };
  return planningAttempt(
    actor,
    'execution.progress',
    payload,
    key,
    async () => {
      await currentExecution(actor, p, id, value.executionId);
      const progressId = crypto.randomUUID(),
        now = new Date().toISOString();
      return planningMutation({
        actor,
        operation: 'execution.progress',
        payload,
        key,
        guard: sql(
          `EXISTS(SELECT 1 FROM planning_orders o JOIN order_executions e ON e.order_id=o.id WHERE o.project_id=? AND o.id=? AND o.revision=? AND o.status IN ('implementing','implemented') AND e.id=? AND e.generation=? AND e.spec_version=o.spec_version AND e.phase IN ('active','paused'))`,
          p,
          id,
          revision,
          value.executionId,
          value.generation,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO order_progress(id,order_id,execution_id,generation,kind,text,next_action,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
            progressId,
            id,
            value.executionId,
            value.generation,
            value.kind,
            value.text,
            value.nextAction,
            now,
            ...gate.params!,
          ),
          sql(
            `UPDATE order_executions SET revision=revision+1,updated_at=? WHERE id=? AND (${gate.sql})`,
            now,
            value.executionId,
            ...gate.params!,
          ),
          sql(
            `UPDATE planning_orders SET revision=revision+1,lifecycle_revision=lifecycle_revision+1 WHERE id=? AND (${gate.sql})`,
            id,
            ...gate.params!,
          ),
        ],
        result: sql(
          `SELECT ${progressJson()} FROM order_progress r WHERE id=?`,
          progressId,
        ),
      });
    },
  );
}
export async function listOrderProgress(
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<Progress>> {
  lifecycleScope(actor, p, id);
  return planningStorage(() =>
    lifecyclePage(
      options,
      { kind: 'orderProgress', p, id },
      orderRevisionQuery(p, id),
      sql(
        `SELECT ${progressJson()} AS data FROM order_progress r JOIN planning_orders o ON o.id=r.order_id WHERE o.project_id=? AND o.id=? ORDER BY r.created_at,r.rowid`,
        p,
        id,
      ),
    ),
  );
}
