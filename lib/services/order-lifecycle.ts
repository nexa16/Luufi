import { getD1 } from '@/lib/data/d1';
import type {
  Approval,
  ApprovalInput,
  ApprovalScope,
  LifecycleEvent,
  LifecycleSummary,
  OrderApproval,
} from '@/lib/domain/execution';
import type {
  Milestone,
  OrderSpec,
  OrderStatus,
  Page,
  PageOptions,
} from '@/lib/domain/planning';
import {
  approvalJson,
  approvalScopeJson,
  dependenciesJson,
  invalidateApprovalItems,
  lifecycleEventJson,
  lifecycleJson,
  lifecycleResult,
  orderApprovalJson,
  reconcileMilestones,
} from './execution-sql';
import {
  authorizePlanning,
  expectedRevision,
  PlanningError,
  planningAttempt,
  planningId,
  planningMutation,
  planningPage,
  planningStorage,
  planningText,
  sql,
  type Sql,
} from './planning-store';

export function inputFields(value: unknown, allowed: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !allowed.includes(field))
  )
    throw new PlanningError(
      'validation',
      'Die Eingabe enthält ungültige Felder.',
    );
}
export function lifecycleScope(actor: string, p: string, id: string) {
  authorizePlanning(actor);
  planningId(p);
  planningId(id);
}
export type ExecutionOrder = {
  id: string;
  status: OrderStatus;
  revision: number;
  spec_version: number;
  lifecycle_revision: number;
  spec_json: string;
  repository: string;
  integration_branch: string;
  milestone_id: string | null;
};
export async function executionOrder(
  actor: string,
  p: string,
  id: string,
): Promise<ExecutionOrder> {
  lifecycleScope(actor, p, id);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(
        'SELECT o.id,o.status,o.revision,o.spec_version,o.lifecycle_revision,o.milestone_id,v.spec_json,p.repository,p.integration_branch FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id JOIN planning_order_versions v ON v.order_id=o.id AND v.version=o.spec_version WHERE o.project_id=? AND o.id=?',
      )
      .bind(p, id)
      .first<ExecutionOrder>();
    if (!row)
      throw new PlanningError(
        'not_found',
        'Dieser Auftrag wurde nicht gefunden.',
      );
    return row;
  });
}
export const orderRevisionQuery = (p: string, id: string) =>
  sql(
    'SELECT o.lifecycle_revision+p.revision AS revision FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id WHERE o.project_id=? AND o.id=?',
    p,
    id,
  );
export async function lifecyclePage<T>(
  options: PageOptions,
  scope: unknown,
  version: Sql,
  query: Sql,
): Promise<Page<T>> {
  const db = getD1(),
    current = await db
      .prepare(version.sql)
      .bind(...version.params!)
      .first<{ revision: number }>();
  if (!current)
    throw new PlanningError(
      'not_found',
      'Dieser Eintrag wurde nicht gefunden.',
    );
  const page = planningPage(options, scope, current.revision);
  const result = await db.batch([
    db
      .prepare(`${query.sql} LIMIT ? OFFSET ?`)
      .bind(...(query.params ?? []), page.limit + 1, page.offset),
    db.prepare(version.sql).bind(...version.params!),
  ]);
  if (
    (result[1].results[0] as { revision: number } | undefined)?.revision !==
    current.revision
  )
    throw new PlanningError(
      'conflict',
      'Die Historie wurde geändert. Bitte beginne die Liste erneut.',
    );
  const rows = result[0].results as { data: string }[];
  return {
    items: rows.slice(0, page.limit).map((row) => JSON.parse(row.data) as T),
    nextCursor: page.next(rows.length > page.limit),
  };
}
export function lifecycleEvent(
  gate: Sql,
  actor: string,
  p: string,
  id: string,
  next: OrderStatus | null,
  reason: string,
  reference: string,
  details: Record<string, unknown>,
  now: string,
): Sql {
  return sql(
    `INSERT INTO order_lifecycle_events(id,order_id,spec_version,actor,previous_status,next_status,reason,reference,details_json,created_at) SELECT ?,id,spec_version,?,status,COALESCE(?,status),?,?,?,? FROM planning_orders WHERE project_id=? AND id=? AND (${gate.sql})`,
    crypto.randomUUID(),
    actor,
    next,
    reason,
    reference,
    JSON.stringify(details),
    now,
    p,
    id,
    ...gate.params!,
  );
}
export function touchLifecycle(
  gate: Sql,
  p: string,
  id: string,
  next: OrderStatus | null = null,
): Sql[] {
  return [
    sql(
      `UPDATE planning_orders SET status=COALESCE(?,status),revision=revision+1,lifecycle_revision=lifecycle_revision+1 WHERE project_id=? AND id=? AND (${gate.sql})`,
      next,
      p,
      id,
      ...gate.params!,
    ),
    sql(
      `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND (${gate.sql})`,
      p,
      ...gate.params!,
    ),
  ];
}
export async function getOrderLifecycle(
  actor: string,
  p: string,
  id: string,
): Promise<LifecycleSummary> {
  lifecycleScope(actor, p, id);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(
        `SELECT ${lifecycleJson()} AS data FROM planning_orders o WHERE project_id=? AND id=?`,
      )
      .bind(p, id)
      .first<{ data: string }>();
    if (!row)
      throw new PlanningError(
        'not_found',
        'Dieser Auftrag wurde nicht gefunden.',
      );
    return JSON.parse(row.data) as LifecycleSummary;
  });
}
function readySpec(spec: OrderSpec) {
  if (
    !spec.scope.trim() ||
    !spec.exclusions.trim() ||
    !spec.criteria.length ||
    !spec.testStrategy.trim() ||
    !spec.prerequisites.trim() ||
    !/^[a-fA-F0-9]{40}$/.test(spec.context.repositoryCommit) ||
    !spec.context.documentationPolicy.trim()
  )
    throw new PlanningError(
      'validation',
      'Bereit benötigt Umfang, Ausschlüsse, Kriterien, Teststrategie, Voraussetzungen und konkreten Repository-/Richtlinienkontext.',
    );
}
export async function markOrderReady(
  actor: string,
  p: string,
  id: string,
  revision: number,
  key: string,
): Promise<LifecycleSummary> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  const payload = { p, id, expectedRevision: revision };
  return planningAttempt(actor, 'lifecycle.ready', payload, key, async () => {
    const current = await executionOrder(actor, p, id);
    readySpec(JSON.parse(current.spec_json) as OrderSpec);
    return planningMutation({
      actor,
      operation: 'lifecycle.ready',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_orders o WHERE project_id=? AND id=? AND revision=? AND status='draft' AND (milestone_id IS NULL OR EXISTS(SELECT 1 FROM planning_milestones WHERE id=o.milestone_id AND state='open')))`,
        p,
        id,
        revision,
      ),
      writes: (gate) => [
        lifecycleEvent(
          gate,
          actor,
          p,
          id,
          'ready',
          'Umfang und Teststrategie geklärt',
          '',
          { action: 'ready' },
          new Date().toISOString(),
        ),
        ...touchLifecycle(gate, p, id, 'ready'),
      ],
      result: lifecycleResult(p, id),
    });
  });
}
type Decision = { reason: string; reference: string };
export function decision(input: Decision) {
  inputFields(input, ['reason', 'reference']);
  return {
    reason: planningText(input.reason, 'Grund', 4000, true),
    reference: planningText(
      input.reference,
      'Nutzer-/Entscheidungsverweis',
      1000,
      true,
    ),
  };
}
async function transition(
  actor: string,
  p: string,
  id: string,
  input: Decision,
  revision: number,
  key: string,
  archive: boolean,
): Promise<LifecycleSummary> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  const value = decision(input),
    operation = archive ? 'lifecycle.archive' : 'lifecycle.return',
    payload = { p, id, ...value, expectedRevision: revision };
  return planningAttempt(actor, operation, payload, key, async () => {
    await executionOrder(actor, p, id);
    return planningMutation({
      actor,
      operation,
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_orders WHERE project_id=? AND id=? AND revision=? AND status ${archive ? "IN ('draft','ready')" : "='ready'"}) AND NOT EXISTS(SELECT 1 FROM order_executions WHERE order_id=? AND phase IN ('active','paused'))`,
        p,
        id,
        revision,
        id,
      ),
      writes: (gate) => [
        lifecycleEvent(
          gate,
          actor,
          p,
          id,
          archive ? 'archived' : 'draft',
          value.reason,
          value.reference,
          { action: archive ? 'archive' : 'returnToDraft' },
          new Date().toISOString(),
        ),
        invalidateApprovalItems(gate, id, value.reason),
        ...touchLifecycle(gate, p, id, archive ? 'archived' : 'draft'),
        ...reconcileMilestones(gate, p),
      ],
      result: lifecycleResult(p, id),
    });
  });
}
export const returnOrderToDraft = (
  actor: string,
  p: string,
  id: string,
  input: Decision,
  revision: number,
  key: string,
) => transition(actor, p, id, input, revision, key, false);
export const archiveOrder = (
  actor: string,
  p: string,
  id: string,
  input: Decision,
  revision: number,
  key: string,
) => transition(actor, p, id, input, revision, key, true);

function approvalInput(input: ApprovalInput) {
  inputFields(input, [
    'mode',
    'orderIds',
    'milestoneId',
    'confirmationReference',
  ]);
  const confirmationReference = planningText(
    input.confirmationReference,
    'Konkrete Nutzerbestätigung',
    1000,
    true,
  );
  if (input.mode === 'selection') {
    if (
      input.milestoneId !== undefined ||
      !Array.isArray(input.orderIds) ||
      !input.orderIds.length ||
      input.orderIds.length > 50
    )
      throw new PlanningError(
        'validation',
        'Eine Auswahl benötigt ein bis fünfzig Auftragskennungen.',
      );
    input.orderIds.forEach(planningId);
    return {
      mode: 'selection' as const,
      orderIds: [...new Set(input.orderIds)].sort(),
      milestoneId: null,
      confirmationReference,
    };
  }
  if (input.mode !== 'milestone' || input.orderIds !== undefined)
    throw new PlanningError('validation', 'Der Freigabeumfang ist ungültig.');
  planningId(input.milestoneId);
  return {
    mode: 'milestone' as const,
    orderIds: [],
    milestoneId: input.milestoneId,
    confirmationReference,
  };
}
export async function recordApproval(
  actor: string,
  p: string,
  input: ApprovalInput,
  revision: number,
  key: string,
): Promise<Approval> {
  authorizePlanning(actor);
  planningId(p);
  expectedRevision(revision);
  const value = approvalInput(input),
    payload = { p, ...value, expectedPlanningRevision: revision };
  return planningAttempt(actor, 'approval.record', payload, key, async () => {
    const db = getD1(),
      project = await db
        .prepare('SELECT 1 FROM planning_projects WHERE id=?')
        .bind(p)
        .first();
    if (!project)
      throw new PlanningError(
        'not_found',
        'Dieses Projekt wurde nicht gefunden.',
      );
    const selected =
      value.mode === 'selection'
        ? sql(
            'o.id IN (SELECT value FROM json_each(?))',
            JSON.stringify(value.orderIds),
          )
        : sql('o.milestone_id=?', value.milestoneId);
    if (
      value.mode === 'milestone' &&
      !(await db
        .prepare(
          "SELECT 1 FROM planning_milestones WHERE project_id=? AND id=? AND state='open'",
        )
        .bind(p, value.milestoneId)
        .first())
    )
      throw new PlanningError(
        'not_found',
        'Dieser offene Milestone wurde nicht gefunden.',
      );
    const rows = await db
      .prepare(
        `SELECT o.id,o.status FROM planning_orders o WHERE o.project_id=? AND ${selected.sql}`,
      )
      .bind(p, ...selected.params!)
      .all<{ id: string; status: string }>();
    if (
      !rows.results.length ||
      (value.mode === 'selection' &&
        rows.results.length !== value.orderIds.length)
    )
      throw new PlanningError(
        'not_found',
        'Die gewählten Aufträge wurden nicht vollständig gefunden.',
      );
    if (rows.results.some((row) => row.status !== 'ready'))
      throw new PlanningError(
        'conflict',
        'Alle Mitglieder müssen bereit sein. Für verbleibende bereite Aufträge bitte eine ausdrückliche Auswahl freigeben.',
      );
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    return planningMutation({
      actor,
      operation: 'approval.record',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND planning_revision=?) AND (SELECT count(*) FROM planning_orders o WHERE o.project_id=? AND ${selected.sql})=? AND NOT EXISTS(SELECT 1 FROM planning_orders o WHERE o.project_id=? AND ${selected.sql} AND o.status!='ready') ${value.mode === 'milestone' ? "AND EXISTS(SELECT 1 FROM planning_milestones WHERE project_id=? AND id=? AND state='open')" : ''}`,
        p,
        revision,
        p,
        ...selected.params!,
        rows.results.length,
        p,
        ...selected.params!,
        ...(value.mode === 'milestone' ? [p, value.milestoneId] : []),
      ),
      writes: (gate) => [
        sql(
          `UPDATE order_approval_items SET invalidated_at=?,invalidated_reason='Durch neuere Freigabe ersetzt' WHERE invalidated_at IS NULL AND order_id IN (SELECT o.id FROM planning_orders o WHERE o.project_id=? AND ${selected.sql}) AND (${gate.sql})`,
          now,
          p,
          ...selected.params!,
          ...gate.params!,
        ),
        sql(
          `INSERT INTO order_approvals(id,project_id,mode,milestone_id,confirmation_reference,created_at) SELECT ?,?,?,?,?,? WHERE ${gate.sql}`,
          id,
          p,
          value.mode,
          value.milestoneId,
          value.confirmationReference,
          now,
          ...gate.params!,
        ),
        sql(
          `INSERT INTO order_approval_items(approval_id,order_id,spec_version,title,dependency_ids_json,repository,integration_branch) SELECT ?,o.id,o.spec_version,json_extract(v.spec_json,'$.title'),${dependenciesJson()},p.repository,p.integration_branch FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id JOIN planning_order_versions v ON v.order_id=o.id AND v.version=o.spec_version WHERE o.project_id=? AND ${selected.sql} AND (${gate.sql})`,
          id,
          p,
          ...selected.params!,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_orders SET revision=revision+1,lifecycle_revision=lifecycle_revision+1 WHERE id IN (SELECT order_id FROM order_approval_items WHERE approval_id=?) AND (${gate.sql})`,
          id,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND (${gate.sql})`,
          p,
          ...gate.params!,
        ),
      ],
      result: sql(
        `SELECT ${approvalJson()} FROM order_approvals a WHERE a.id=?`,
        id,
      ),
    });
  });
}
export async function revokeApproval(
  actor: string,
  p: string,
  id: string,
  input: Decision,
  revision: number,
  key: string,
): Promise<Approval> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  const value = decision(input),
    payload = { p, id, ...value, expectedRevision: revision };
  return planningAttempt(actor, 'approval.revoke', payload, key, async () => {
    const exists = await getD1()
      .prepare('SELECT 1 FROM order_approvals WHERE project_id=? AND id=?')
      .bind(p, id)
      .first();
    if (!exists)
      throw new PlanningError(
        'not_found',
        'Diese Freigabe wurde nicht gefunden.',
      );
    const now = new Date().toISOString();
    return planningMutation({
      actor,
      operation: 'approval.revoke',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM order_approvals WHERE project_id=? AND id=? AND revision=? AND revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM order_executions e JOIN order_approval_items i ON i.order_id=e.order_id WHERE i.approval_id=? AND e.phase IN ('active','paused'))`,
        p,
        id,
        revision,
        id,
      ),
      writes: (gate) => [
        sql(
          `INSERT INTO order_lifecycle_events(id,order_id,spec_version,actor,previous_status,next_status,reason,reference,details_json,created_at) SELECT lower(hex(randomblob(16))),o.id,o.spec_version,?,o.status,o.status,?,?,?,? FROM planning_orders o JOIN order_approval_items i ON i.order_id=o.id WHERE i.approval_id=? AND (${gate.sql})`,
          actor,
          value.reason,
          value.reference,
          JSON.stringify({ action: 'revokeApproval', approvalId: id }),
          now,
          id,
          ...gate.params!,
        ),
        sql(
          `UPDATE order_approvals SET revoked_at=?,revision=revision+1 WHERE id=? AND (${gate.sql})`,
          now,
          id,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_orders SET revision=revision+1,lifecycle_revision=lifecycle_revision+1 WHERE id IN (SELECT order_id FROM order_approval_items WHERE approval_id=?) AND (${gate.sql})`,
          id,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND (${gate.sql})`,
          p,
          ...gate.params!,
        ),
      ],
      result: sql(
        `SELECT ${approvalJson()} FROM order_approvals a WHERE a.id=?`,
        id,
      ),
    });
  });
}
export async function listOrderApprovals(
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<OrderApproval>> {
  lifecycleScope(actor, p, id);
  return planningStorage(() =>
    lifecyclePage(
      options,
      { kind: 'orderApprovals', p, id },
      orderRevisionQuery(p, id),
      sql(
        `SELECT ${orderApprovalJson()} AS data FROM order_approvals a JOIN order_approval_items i ON i.approval_id=a.id JOIN planning_orders o ON o.id=i.order_id WHERE o.project_id=? AND o.id=? ORDER BY a.created_at DESC,a.rowid DESC`,
        p,
        id,
      ),
    ),
  );
}
export async function listApprovalItems(
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<ApprovalScope>> {
  lifecycleScope(actor, p, id);
  return planningStorage(() =>
    lifecyclePage(
      options,
      { kind: 'approvalItems', p, id },
      sql(
        'SELECT a.revision+p.revision+COALESCE((SELECT SUM(o.lifecycle_revision+1) FROM order_approval_items i JOIN planning_orders o ON o.id=i.order_id WHERE i.approval_id=a.id),0) AS revision FROM order_approvals a JOIN planning_projects p ON p.id=a.project_id WHERE a.project_id=? AND a.id=?',
        p,
        id,
      ),
      sql(
        `SELECT ${approvalScopeJson()} AS data FROM order_approval_items i JOIN order_approvals a ON a.id=i.approval_id WHERE a.project_id=? AND a.id=? ORDER BY i.order_id`,
        p,
        id,
      ),
    ),
  );
}
export async function listLifecycleEvents(
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<LifecycleEvent>> {
  lifecycleScope(actor, p, id);
  return planningStorage(() =>
    lifecyclePage(
      options,
      { kind: 'lifecycleEvents', p, id },
      orderRevisionQuery(p, id),
      sql(
        `SELECT ${lifecycleEventJson()} AS data FROM order_lifecycle_events e JOIN planning_orders o ON o.id=e.order_id WHERE o.project_id=? AND o.id=? ORDER BY e.created_at,e.rowid`,
        p,
        id,
      ),
    ),
  );
}
export async function closeMilestone(
  actor: string,
  p: string,
  id: string,
  input: { confirmEmpty: boolean },
  revision: number,
  key: string,
): Promise<Milestone> {
  lifecycleScope(actor, p, id);
  expectedRevision(revision);
  inputFields(input, ['confirmEmpty']);
  if (typeof input.confirmEmpty !== 'boolean')
    throw new PlanningError(
      'validation',
      'Die Bestätigung für einen leeren Milestone fehlt.',
    );
  const payload = {
    p,
    id,
    confirmEmpty: input.confirmEmpty,
    expectedRevision: revision,
  };
  return planningAttempt(actor, 'milestone.close', payload, key, async () => {
    if (
      !(await getD1()
        .prepare(
          'SELECT 1 FROM planning_milestones WHERE project_id=? AND id=?',
        )
        .bind(p, id)
        .first())
    )
      throw new PlanningError(
        'not_found',
        'Dieser Milestone wurde nicht gefunden.',
      );
    return planningMutation({
      actor,
      operation: 'milestone.close',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_milestones WHERE project_id=? AND id=? AND revision=? AND state='open') AND (?=1 OR EXISTS(SELECT 1 FROM planning_orders WHERE milestone_id=?)) AND NOT EXISTS(SELECT 1 FROM planning_orders WHERE milestone_id=? AND status NOT IN ('done','archived'))`,
        p,
        id,
        revision,
        input.confirmEmpty ? 1 : 0,
        id,
        id,
      ),
      writes: (gate) => [
        sql(
          `UPDATE planning_milestones SET state='closed',revision=revision+1 WHERE id=? AND (${gate.sql})`,
          id,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND (${gate.sql})`,
          p,
          ...gate.params!,
        ),
      ],
      result: sql(
        "SELECT json_object('id',id,'projectId',project_id,'title',title,'description',description,'state',state,'position',position,'revision',revision) FROM planning_milestones WHERE id=?",
        id,
      ),
    });
  });
}
