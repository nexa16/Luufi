import { sql, type Sql } from './planning-store';
// Aliases are code-owned constants, never native caller input.
export const dependenciesJson = (order = 'o') =>
  `COALESCE((SELECT json_group_array(target_id) FROM (SELECT target_id FROM planning_order_relations WHERE source_id=${order}.id AND type='depends_on' ORDER BY target_id)),json('[]'))`;
export const approvalValid = (a = 'a', i = 'i', o = 'o') =>
  `(${a}.revoked_at IS NULL AND ${i}.invalidated_at IS NULL AND ${i}.spec_version=${o}.spec_version AND ${i}.repository=(SELECT repository FROM planning_projects WHERE id=${o}.project_id) AND ${i}.integration_branch=(SELECT integration_branch FROM planning_projects WHERE id=${o}.project_id) AND ${i}.dependency_ids_json=${dependenciesJson(o)})`;
export const approvalReason = (a = 'a', i = 'i', o = 'o') =>
  `CASE WHEN ${a}.revoked_at IS NOT NULL THEN 'Freigabe widerrufen' WHEN ${i}.invalidated_at IS NOT NULL THEN ${i}.invalidated_reason WHEN NOT ${approvalValid(a, i, o)} THEN 'Fassung oder Voraussetzungen verändert' ELSE '' END`;
export const approvalJson = (a = 'a') =>
  `json_object('id',${a}.id,'projectId',${a}.project_id,'revision',${a}.revision,'mode',${a}.mode,'milestoneId',${a}.milestone_id,'confirmationReference',${a}.confirmation_reference,'itemCount',(SELECT count(*) FROM order_approval_items WHERE approval_id=${a}.id),'createdAt',${a}.created_at,'revokedAt',${a}.revoked_at)`;
export const approvalScopeJson = (i = 'i') =>
  `json_object('orderId',${i}.order_id,'specVersion',${i}.spec_version,'title',${i}.title,'dependencyIds',json(${i}.dependency_ids_json),'repository',${i}.repository,'integrationBranch',${i}.integration_branch,'invalidatedAt',${i}.invalidated_at,'invalidatedReason',${i}.invalidated_reason)`;
export const orderApprovalJson = (a = 'a', i = 'i', o = 'o') =>
  `json_set(${approvalJson(a)},'$.scope',${approvalScopeJson(i)},'$.valid',json(CASE WHEN ${approvalValid(a, i, o)} THEN 'true' ELSE 'false' END),'$.reason',${approvalReason(a, i, o)})`;
export const executionJson = (e = 'e') =>
  `json_object('id',${e}.id,'projectId',${e}.project_id,'orderId',${e}.order_id,'specVersion',${e}.spec_version,'approvalId',${e}.approval_id,'worker',${e}.worker,'branch',${e}.branch,'generation',${e}.generation,'revision',${e}.revision,'phase',${e}.phase,'createdAt',${e}.created_at,'updatedAt',${e}.updated_at)`;
export const progressJson = (r = 'r') =>
  `json_object('id',${r}.id,'orderId',${r}.order_id,'executionId',${r}.execution_id,'generation',${r}.generation,'kind',${r}.kind,'text',${r}.text,'nextAction',${r}.next_action,'createdAt',${r}.created_at)`;
export const lifecycleEventJson = (e = 'e') =>
  `json_object('id',${e}.id,'orderId',${e}.order_id,'specVersion',${e}.spec_version,'actor',${e}.actor,'previousStatus',${e}.previous_status,'nextStatus',${e}.next_status,'reason',${e}.reason,'reference',${e}.reference,'details',json(${e}.details_json),'createdAt',${e}.created_at)`;
export const evidenceJson = (e = 'e') =>
  `json_set(json(${e}.payload_json),'$.id',${e}.id,'$.orderId',${e}.order_id,'$.specVersion',${e}.spec_version,'$.kind',${e}.kind,'$.outcome',${e}.outcome,'$.executionId',${e}.execution_id,'$.generation',${e}.generation,'$.supersedesId',${e}.supersedes_id,'$.createdAt',${e}.created_at)`;
export const lifecycleJson = (o = 'o') =>
  `json_object('orderId',${o}.id,'revision',${o}.revision,'lifecycleRevision',${o}.lifecycle_revision,'approval',json((SELECT json_object('id',a.id,'specVersion',i.spec_version,'valid',json(CASE WHEN ${approvalValid('a', 'i', o)} THEN 'true' ELSE 'false' END),'reason',${approvalReason('a', 'i', o)}) FROM order_approvals a JOIN order_approval_items i ON i.approval_id=a.id WHERE i.order_id=${o}.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1)),'execution',json((SELECT ${executionJson()} FROM order_executions e WHERE e.order_id=${o}.id AND e.phase IN ('active','paused') LIMIT 1)),'currentImplementationId',${o}.current_implementation_id,'integrationId',${o}.integration_id)`;
export const lifecycleResult = (projectId: string, id: string) =>
  sql(
    `SELECT ${lifecycleJson()} FROM planning_orders o WHERE o.project_id=? AND o.id=?`,
    projectId,
    id,
  );
export function invalidateApprovalItems(gate: Sql, id: string, reason: string) {
  return sql(
    `UPDATE order_approval_items SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),invalidated_reason=CASE WHEN invalidated_at IS NULL THEN ? ELSE invalidated_reason END WHERE order_id=? AND (${gate.sql})`,
    reason,
    id,
    ...(gate.params ?? []),
  );
}
export function reconcileMilestones(gate: Sql, projectId: string): Sql[] {
  const closable = `m.project_id=? AND m.state='open' AND EXISTS(SELECT 1 FROM planning_orders WHERE milestone_id=m.id) AND NOT EXISTS(SELECT 1 FROM planning_orders WHERE milestone_id=m.id AND status NOT IN ('done','archived'))`;
  return [
    sql(
      `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM planning_milestones m WHERE ${closable}) AND (${gate.sql})`,
      projectId,
      projectId,
      ...(gate.params ?? []),
    ),
    sql(
      `UPDATE planning_milestones AS m SET state='closed',revision=revision+1 WHERE ${closable} AND (${gate.sql})`,
      projectId,
      ...(gate.params ?? []),
    ),
  ];
}
