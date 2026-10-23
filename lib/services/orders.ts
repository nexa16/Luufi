import { getD1 } from '@/lib/data/d1';
import {
  orderStatuses,
  orderTypes,
  type Order,
  type OrderFilters,
  type OrderSpec,
  type OrderType,
  type Page,
} from '@/lib/domain/planning';
import {
  authorizePlanning,
  expectedRevision,
  planningId,
  planningMutation,
  planningPage,
  planningReplay,
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
  const replay = await planningReplay<Order>(
    actor,
    'order.create',
    payload,
    requestKey,
  );
  if (replay !== undefined) return replay;
  return planningStorage(async () => {
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
  });
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
  const replay = await planningReplay<Order>(
    actor,
    'order.update',
    payload,
    requestKey,
  );
  if (replay !== undefined) return replay;
  return planningStorage(async () => {
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
  });
}
