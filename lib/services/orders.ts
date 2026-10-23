import { getD1 } from '@/lib/data/d1';
import {
  orderStatuses,
  orderTypes,
  relationTypes,
  type Order,
  type OrderFilters,
  type OrderSpec,
  type OrderType,
  type Page,
  type RelationType,
} from '@/lib/domain/planning';
import {
  authorizePlanning,
  expectedRevision,
  planningId,
  planningMutation,
  planningPage,
  planningAttempt,
  planningStorage,
  planningText,
  PlanningError,
  sql,
} from './planning-store';

type OrderInput = { type: OrderType; spec: Partial<OrderSpec> };
type ProjectState = { planning_revision: number };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new PlanningError(
      'validation',
      'Die Eingabe enthält nicht unterstützte Felder.',
    );
}
function normalized(input: OrderInput): OrderInput & { spec: OrderSpec } {
  if (!record(input))
    throw new PlanningError(
      'validation',
      'Ein Auftragsentwurf ist erforderlich.',
    );
  keys(input, ['type', 'spec']);
  if (!orderTypes.includes(input.type))
    throw new PlanningError('validation', 'Der Auftragstyp ist ungültig.');
  if (!record(input.spec))
    throw new PlanningError(
      'validation',
      'Eine Auftragsspezifikation ist erforderlich.',
    );
  const value = input.spec;
  keys(value, [
    'title',
    'goal',
    'origin',
    'problem',
    'scope',
    'exclusions',
    'flows',
    'criteria',
    'testStrategy',
    'prerequisites',
    'documentation',
    'context',
    'sources',
  ]);
  const spec: OrderSpec = {
    title: planningText(value.title, 'Titel', 280, true),
    goal: planningText(value.goal, 'Ziel', 4000, true),
    origin: planningText(value.origin, 'Herkunft', 4000, true),
    problem: planningText(
      value.problem === undefined ? '' : value.problem,
      'Nutzerproblem',
    ),
    scope: planningText(value.scope === undefined ? '' : value.scope, 'Umfang'),
    exclusions: planningText(
      value.exclusions === undefined ? '' : value.exclusions,
      'Ausschlüsse',
    ),
    flows: planningText(
      value.flows === undefined ? '' : value.flows,
      'Abläufe',
    ),
    testStrategy: planningText(
      value.testStrategy === undefined ? '' : value.testStrategy,
      'Teststrategie',
    ),
    prerequisites: planningText(
      value.prerequisites === undefined ? '' : value.prerequisites,
      'Voraussetzungen',
    ),
    documentation: planningText(
      value.documentation === undefined ? '' : value.documentation,
      'Dokumentation',
    ),
    criteria: [],
    sources: [],
    context: { repositoryCommit: '', documentationPolicy: '' },
  };
  if (value.criteria !== undefined) {
    if (!Array.isArray(value.criteria) || value.criteria.length > 50)
      throw new PlanningError(
        'validation',
        'Höchstens 50 Akzeptanzkriterien sind erlaubt.',
      );
    const ids = new Set<string>();
    spec.criteria = value.criteria.map((criterion) => {
      if (!record(criterion))
        throw new PlanningError(
          'validation',
          'Das Akzeptanzkriterium ist ungültig.',
        );
      keys(criterion, ['id', 'text']);
      const id = planningText(criterion.id, 'Kriterienkennung', 64, true);
      if (ids.has(id))
        throw new PlanningError(
          'validation',
          'Kriterienkennungen müssen eindeutig sein.',
        );
      ids.add(id);
      return {
        id,
        text: planningText(criterion.text, 'Akzeptanzkriterium', 1000, true),
      };
    });
  }
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > 50)
      throw new PlanningError(
        'validation',
        'Höchstens 50 Quellen sind erlaubt.',
      );
    spec.sources = value.sources.map((source) =>
      planningText(source, 'Quelle', 1000, true),
    );
  }
  if (value.context !== undefined) {
    if (!record(value.context))
      throw new PlanningError(
        'validation',
        'Der Spezifikationskontext ist ungültig.',
      );
    keys(value.context, ['repositoryCommit', 'documentationPolicy']);
    const repositoryCommit = planningText(
      value.context.repositoryCommit === undefined
        ? ''
        : value.context.repositoryCommit,
      'Repository-Commit',
      40,
    );
    if (repositoryCommit && !/^[a-fA-F0-9]{40}$/.test(repositoryCommit))
      throw new PlanningError(
        'validation',
        'Der Repository-Commit muss ein vollständiger 40-stelliger SHA sein.',
      );
    spec.context = {
      repositoryCommit,
      documentationPolicy: planningText(
        value.context.documentationPolicy === undefined
          ? ''
          : value.context.documentationPolicy,
        'Dokumentationsrichtlinie',
        32,
      ),
    };
  }
  return { type: input.type, spec };
}

// Correlated subqueries keep the current specification, immutable ascending
// history and stable relations in one database snapshot and one replay value.
const response = `json_object(
  'id',o.id,'projectId',o.project_id,'number',o.number,'displayId',p.project_key||'-'||o.number,
  'type',o.type,'status',o.status,'specVersion',o.spec_version,'revision',o.revision,
  'milestoneId',o.milestone_id,'position',o.position,
  'spec',json((SELECT spec_json FROM planning_order_versions WHERE order_id=o.id AND version=o.spec_version)),
  'history',json((SELECT json_group_array(json_object('version',v.version,'spec',json(v.spec_json),'createdAt',v.created_at))
    FROM (SELECT version,spec_json,created_at FROM planning_order_versions WHERE order_id=o.id ORDER BY version) v)),
  'relations',json((SELECT json_group_array(json_object('targetId',r.target_id,'type',r.type))
    FROM (SELECT target_id,type FROM planning_order_relations WHERE source_id=o.id ORDER BY type,target_id) r))
)`;
const from =
  'FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id';
const orderResult = (projectId: string, id: string) =>
  sql(
    `SELECT ${response} ${from} WHERE o.project_id=? AND o.id=?`,
    projectId,
    id,
  );

async function projectState(projectId: string): Promise<ProjectState> {
  const project = await getD1()
    .prepare('SELECT planning_revision FROM planning_projects WHERE id=?')
    .bind(projectId)
    .first<ProjectState>();
  if (!project)
    throw new PlanningError(
      'not_found',
      'Dieses Projekt wurde nicht gefunden.',
    );
  return project;
}

export async function getOrder(
  actor: string,
  projectId: string,
  id: string,
): Promise<Order> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  return planningStorage(async () => {
    const found = await getD1()
      .prepare(
        `SELECT ${response} AS result_json ${from} WHERE o.project_id=? AND o.id=?`,
      )
      .bind(projectId, id)
      .first<{ result_json: string }>();
    if (!found)
      throw new PlanningError(
        'not_found',
        'Dieser Auftrag wurde nicht gefunden.',
      );
    return JSON.parse(found.result_json) as Order;
  });
}

export async function listOrders(
  actor: string,
  projectId: string,
  filters: OrderFilters = {},
): Promise<Page<Order>> {
  authorizePlanning(actor);
  planningId(projectId);
  if (!record(filters))
    throw new PlanningError('validation', 'Die Auftragsfilter sind ungültig.');
  keys(filters, ['limit', 'cursor', 'milestoneId', 'status', 'type']);
  if (filters.status !== undefined && !orderStatuses.includes(filters.status))
    throw new PlanningError('validation', 'Der Auftragsstatus ist ungültig.');
  if (filters.type !== undefined && !orderTypes.includes(filters.type))
    throw new PlanningError('validation', 'Der Auftragstyp ist ungültig.');
  if (filters.milestoneId !== undefined && filters.milestoneId !== null)
    planningId(filters.milestoneId);
  return planningStorage(async () => {
    const project = await projectState(projectId);
    const scope = {
      projectId,
      milestoneId: filters.milestoneId ?? null,
      unplanned: filters.milestoneId === null,
      status: filters.status ?? null,
      type: filters.type ?? null,
    };
    const page = planningPage(filters, scope, project.planning_revision);
    const clauses = ['o.project_id=?'];
    const params: (string | number | null)[] = [projectId];
    if (filters.milestoneId === null) clauses.push('o.milestone_id IS NULL');
    else if (filters.milestoneId !== undefined) {
      clauses.push('o.milestone_id=?');
      params.push(filters.milestoneId);
    }
    if (filters.status !== undefined) {
      clauses.push('o.status=?');
      params.push(filters.status);
    }
    if (filters.type !== undefined) {
      clauses.push('o.type=?');
      params.push(filters.type);
    }
    const db = getD1();
    const results = await db.batch([
      db
        .prepare(
          `SELECT ${response} AS result_json ${from} LEFT JOIN planning_milestones m ON m.id=o.milestone_id WHERE ${clauses.join(' AND ')} ORDER BY CASE WHEN o.milestone_id IS NULL THEN 1 ELSE 0 END,m.position,m.id,o.position,o.id LIMIT ? OFFSET ?`,
        )
        .bind(...params, page.limit + 1, page.offset),
      db
        .prepare('SELECT planning_revision FROM planning_projects WHERE id=?')
        .bind(projectId),
    ]);
    if (
      (results[1].results[0] as ProjectState | undefined)?.planning_revision !==
      project.planning_revision
    )
      throw new PlanningError(
        'conflict',
        'Die Projektplanung wurde geändert. Bitte beginne die Liste erneut.',
      );
    const rows = results[0].results as { result_json: string }[];
    return {
      items: rows
        .slice(0, page.limit)
        .map((row) => JSON.parse(row.result_json) as Order),
      nextCursor: page.next(rows.length > page.limit),
    };
  });
}

export async function createOrder(
  actor: string,
  projectId: string,
  input: OrderInput,
  requestKey: string,
): Promise<Order> {
  authorizePlanning(actor);
  planningId(projectId);
  const content = normalized(input);
  const payload = { projectId, ...content };
  return planningAttempt<Order>(
    actor,
    'order.create',
    payload,
    requestKey,
    async () => {
      await projectState(projectId);
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return planningMutation<Order>({
        actor,
        operation: 'order.create',
        payload,
        key: requestKey,
        guard: sql(
          'EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND next_order_number < ?)',
          projectId,
          Number.MAX_SAFE_INTEGER,
        ),
        writes: (gate) => [
          sql(
            `UPDATE planning_projects SET next_order_number=next_order_number+1,planning_revision=planning_revision+1 WHERE id=? AND ${gate.sql}`,
            projectId,
            ...gate.params!,
          ),
          sql(
            `INSERT INTO planning_orders(id,project_id,number,type,status,spec_version,revision,milestone_id,position)
          SELECT ?,p.id,p.next_order_number-1,?,'draft',1,0,NULL,COALESCE((SELECT MAX(position)+1 FROM planning_orders WHERE project_id=p.id AND milestone_id IS NULL),0)
          FROM planning_projects p WHERE p.id=? AND ${gate.sql}`,
            id,
            content.type,
            projectId,
            ...gate.params!,
          ),
          sql(
            `INSERT INTO planning_order_versions(order_id,version,spec_json,created_at) SELECT ?,1,?,? WHERE ${gate.sql}`,
            id,
            JSON.stringify(content.spec),
            createdAt,
            ...gate.params!,
          ),
        ],
        result: orderResult(projectId, id),
      });
    },
  );
}

export async function updateDraftOrder(
  actor: string,
  projectId: string,
  id: string,
  input: OrderInput,
  revision: number,
  requestKey: string,
): Promise<Order> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  expectedRevision(revision);
  const content = normalized(input);
  const payload = { projectId, id, ...content, expectedRevision: revision };
  return planningAttempt<Order>(
    actor,
    'order.update',
    payload,
    requestKey,
    async () => {
      await getOrder(actor, projectId, id);
      return planningMutation<Order>({
        actor,
        operation: 'order.update',
        payload,
        key: requestKey,
        guard: sql(
          "EXISTS(SELECT 1 FROM planning_orders WHERE id=? AND project_id=? AND revision=? AND status='draft')",
          id,
          projectId,
          revision,
        ),
        writes: (gate) => [
          sql(
            `UPDATE planning_orders SET type=?,spec_version=spec_version+1,revision=revision+1 WHERE id=? AND ${gate.sql}`,
            content.type,
            id,
            ...gate.params!,
          ),
          sql(
            `INSERT INTO planning_order_versions(order_id,version,spec_json,created_at) SELECT id,spec_version,?,? FROM planning_orders WHERE id=? AND ${gate.sql}`,
            JSON.stringify(content.spec),
            new Date().toISOString(),
            id,
            ...gate.params!,
          ),
          sql(
            `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND ${gate.sql}`,
            projectId,
            ...gate.params!,
          ),
        ],
        result: orderResult(projectId, id),
      });
    },
  );
}

// LUUFI-7: planning placement and directed relations keep specification
// snapshots unchanged. All mutable membership/dependency checks run in guard.
type PlacementRow = { id: string; milestone_id: string | null };
function placementConflict(): never {
  throw new PlanningError(
    'conflict',
    'Die Zuordnung ist nicht mehr möglich. Bitte lade den Projektplan erneut.',
  );
}

function editableOrder(projectId: string, id: string, revision: number) {
  return sql(
    `EXISTS(SELECT 1 FROM planning_orders s WHERE s.id=? AND s.project_id=? AND s.revision=? AND s.status IN ('draft','ready')
    AND (s.milestone_id IS NULL OR EXISTS(SELECT 1 FROM planning_milestones sm WHERE sm.id=s.milestone_id AND sm.project_id=s.project_id AND sm.state='open')))`,
    id,
    projectId,
    revision,
  );
}

export async function placeOrder(
  actor: string,
  projectId: string,
  id: string,
  milestoneId: string | null,
  beforeId: string | null,
  revision: number,
  planningRevision: number,
  requestKey: string,
): Promise<Order> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  if (milestoneId !== null) planningId(milestoneId);
  if (beforeId !== null) planningId(beforeId);
  expectedRevision(revision);
  expectedRevision(planningRevision);
  const payload = {
    projectId,
    id,
    milestoneId,
    beforeId,
    expectedRevision: revision,
    expectedPlanningRevision: planningRevision,
  };
  return planningAttempt<Order>(
    actor,
    'order.place',
    payload,
    requestKey,
    async () => {
      await getOrder(actor, projectId, id);
      const db = getD1();
      const snapshot = await db.batch([
        db
          .prepare(
            'SELECT id,milestone_id FROM planning_orders WHERE project_id=? ORDER BY position,id',
          )
          .bind(projectId),
        db
          .prepare('SELECT planning_revision FROM planning_projects WHERE id=?')
          .bind(projectId),
      ]);
      if (
        (snapshot[1].results[0] as ProjectState | undefined)
          ?.planning_revision !== planningRevision
      )
        placementConflict();
      const rows = snapshot[0].results as PlacementRow[];
      const source = rows.find((row) => row.id === id);
      if (!source || beforeId === id) placementConflict();
      const target = rows
        .filter((row) => row.milestone_id === milestoneId && row.id !== id)
        .map((row) => row.id);
      const index =
        beforeId === null ? target.length : target.indexOf(beforeId);
      if (index < 0) placementConflict();
      target.splice(index, 0, id);
      const groups =
        source.milestone_id === milestoneId
          ? [target]
          : [
              rows
                .filter(
                  (row) =>
                    row.milestone_id === source.milestone_id && row.id !== id,
                )
                .map((row) => row.id),
              target,
            ];
      const editable = editableOrder(projectId, id, revision);
      const milestoneGuard =
        milestoneId === null
          ? sql('1')
          : sql(
              "EXISTS(SELECT 1 FROM planning_milestones WHERE id=? AND project_id=? AND state='open')",
              milestoneId,
              projectId,
            );
      const anchorGuard =
        beforeId === null
          ? sql('1')
          : sql(
              'EXISTS(SELECT 1 FROM planning_orders WHERE id=? AND project_id=? AND milestone_id IS ? AND id<>?)',
              beforeId,
              projectId,
              milestoneId,
              id,
            );
      return planningMutation<Order>({
        actor,
        operation: 'order.place',
        payload,
        key: requestKey,
        guard: sql(
          `(${editable.sql}) AND EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND planning_revision=?) AND (${milestoneGuard.sql}) AND (${anchorGuard.sql})`,
          ...editable.params!,
          projectId,
          planningRevision,
          ...milestoneGuard.params!,
          ...anchorGuard.params!,
        ),
        writes: (gate) => [
          sql(
            `UPDATE planning_orders SET milestone_id=?,revision=revision+1 WHERE id=? AND ${gate.sql}`,
            milestoneId,
            id,
            ...gate.params!,
          ),
          ...groups.map((group) => {
            const ids = JSON.stringify(group);
            return sql(
              `UPDATE planning_orders SET position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=planning_orders.id) WHERE project_id=? AND id IN (SELECT value FROM json_each(?)) AND ${gate.sql}`,
              ids,
              projectId,
              ids,
              ...gate.params!,
            );
          }),
          sql(
            `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND ${gate.sql}`,
            projectId,
            ...gate.params!,
          ),
        ],
        result: orderResult(projectId, id),
      });
    },
  );
}

async function mutateRelation(
  remove: boolean,
  actor: string,
  projectId: string,
  id: string,
  targetId: string,
  type: RelationType,
  revision: number,
  requestKey: string,
): Promise<Order> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  planningId(targetId);
  expectedRevision(revision);
  if (!relationTypes.includes(type))
    throw new PlanningError('validation', 'Der Beziehungstyp ist ungültig.');
  const operation = remove ? 'order.relation.remove' : 'order.relation.set';
  const payload = { projectId, id, targetId, type, expectedRevision: revision };
  return planningAttempt<Order>(
    actor,
    operation,
    payload,
    requestKey,
    async () => {
      await getOrder(actor, projectId, id);
      const target = await getD1()
        .prepare('SELECT project_id FROM planning_orders WHERE id=?')
        .bind(targetId)
        .first<{ project_id: string }>();
      if (!target)
        throw new PlanningError(
          'not_found',
          'Der Zielauftrag wurde nicht gefunden.',
        );
      if (target.project_id !== projectId || id === targetId)
        throw new PlanningError(
          'conflict',
          'Auftragsbeziehungen benötigen unterschiedliche Aufträge desselben Projekts.',
        );
      if (
        remove &&
        !(await getD1()
          .prepare(
            'SELECT 1 FROM planning_order_relations WHERE source_id=? AND target_id=? AND type=?',
          )
          .bind(id, targetId, type)
          .first())
      )
        throw new PlanningError(
          'not_found',
          'Diese Auftragsbeziehung wurde nicht gefunden.',
        );
      const editable = editableOrder(projectId, id, revision);
      const acyclic =
        !remove && type === 'depends_on'
          ? sql(
              `NOT EXISTS(WITH RECURSIVE reachable(id) AS (
          SELECT ? UNION SELECT r.target_id FROM planning_order_relations r JOIN reachable v ON r.source_id=v.id WHERE r.type='depends_on'
        ) SELECT 1 FROM reachable WHERE id=?)`,
              targetId,
              id,
            )
          : sql('1');
      return planningMutation<Order>({
        actor,
        operation,
        payload,
        key: requestKey,
        guard: sql(
          `(${editable.sql}) AND EXISTS(SELECT 1 FROM planning_orders t WHERE t.id=? AND t.project_id=?
          AND (t.milestone_id IS NULL OR EXISTS(SELECT 1 FROM planning_milestones tm WHERE tm.id=t.milestone_id AND tm.project_id=t.project_id AND tm.state='open')))
        AND ${remove ? '' : 'NOT '}EXISTS(SELECT 1 FROM planning_order_relations WHERE source_id=? AND target_id=? AND type=?) AND (${acyclic.sql})`,
          ...editable.params!,
          targetId,
          projectId,
          id,
          targetId,
          type,
          ...acyclic.params!,
        ),
        writes: (gate) => [
          remove
            ? sql(
                `DELETE FROM planning_order_relations WHERE source_id=? AND target_id=? AND type=? AND ${gate.sql}`,
                id,
                targetId,
                type,
                ...gate.params!,
              )
            : sql(
                `INSERT INTO planning_order_relations(source_id,target_id,type) SELECT ?,?,? WHERE ${gate.sql}`,
                id,
                targetId,
                type,
                ...gate.params!,
              ),
          sql(
            `UPDATE planning_orders SET revision=revision+1 WHERE id=? AND ${gate.sql}`,
            id,
            ...gate.params!,
          ),
          sql(
            `UPDATE planning_projects SET planning_revision=planning_revision+1 WHERE id=? AND ${gate.sql}`,
            projectId,
            ...gate.params!,
          ),
        ],
        result: orderResult(projectId, id),
      });
    },
  );
}

export function setOrderRelation(
  actor: string,
  projectId: string,
  id: string,
  targetId: string,
  type: RelationType,
  revision: number,
  requestKey: string,
): Promise<Order> {
  return mutateRelation(
    false,
    actor,
    projectId,
    id,
    targetId,
    type,
    revision,
    requestKey,
  );
}

export function removeOrderRelation(
  actor: string,
  projectId: string,
  id: string,
  targetId: string,
  type: RelationType,
  revision: number,
  requestKey: string,
): Promise<Order> {
  return mutateRelation(
    true,
    actor,
    projectId,
    id,
    targetId,
    type,
    revision,
    requestKey,
  );
}
