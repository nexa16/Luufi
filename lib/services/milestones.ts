import { getD1 } from '@/lib/data/d1';
import type { Milestone, Page, PageOptions } from '@/lib/domain/planning';
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

type MilestoneRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  state: 'open' | 'closed';
  position: number;
  revision: number;
};
export type MilestoneInput = { title: string; description?: string };

function milestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    state: row.state,
    position: row.position,
    revision: row.revision,
  };
}

function normalizedInput(value: MilestoneInput) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['title', 'description'].includes(key))
  ) {
    throw new PlanningError(
      'validation',
      'Nur Titel und Beschreibung dürfen geändert werden.',
    );
  }
  return {
    title: planningText(value.title, 'Titel', 280, true),
    description: planningText(
      value.description === undefined ? '' : value.description,
      'Beschreibung',
    ),
  };
}

async function projectRevision(projectId: string): Promise<number> {
  const project = await getD1()
    .prepare('SELECT planning_revision FROM planning_projects WHERE id = ?')
    .bind(projectId)
    .first<{ planning_revision: number }>();
  if (!project)
    throw new PlanningError(
      'not_found',
      'Dieses Projekt wurde nicht gefunden.',
    );
  return project.planning_revision;
}

function milestoneResult(projectId: string, id: string) {
  return sql(
    "SELECT json_object('id', id, 'projectId', project_id, 'title', title, 'description', description, 'state', state, 'position', position, 'revision', revision) FROM planning_milestones WHERE project_id = ? AND id = ?",
    projectId,
    id,
  );
}

export async function listMilestones(
  actor: string,
  projectId: string,
  options: PageOptions = {},
): Promise<Page<Milestone>> {
  authorizePlanning(actor);
  planningId(projectId);
  return planningStorage(async () => {
    const revision = await projectRevision(projectId);
    const page = planningPage(
      options,
      { kind: 'milestones', projectId },
      revision,
    );
    const { results } = await getD1()
      .prepare(
        'SELECT id, project_id, title, description, state, position, revision FROM planning_milestones WHERE project_id = ? ORDER BY position, id LIMIT ? OFFSET ?',
      )
      .bind(projectId, page.limit + 1, page.offset)
      .all<MilestoneRow>();
    if ((await projectRevision(projectId)) !== revision)
      throw new PlanningError(
        'conflict',
        'Die Planung wurde geändert. Bitte beginne die Liste erneut.',
      );
    return {
      items: results.slice(0, page.limit).map(milestone),
      nextCursor: page.next(results.length > page.limit),
    };
  });
}

export async function getMilestone(
  actor: string,
  projectId: string,
  id: string,
): Promise<Milestone> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(
        'SELECT id, project_id, title, description, state, position, revision FROM planning_milestones WHERE project_id = ? AND id = ?',
      )
      .bind(projectId, id)
      .first<MilestoneRow>();
    if (!row)
      throw new PlanningError(
        'not_found',
        'Dieser Milestone wurde nicht gefunden.',
      );
    return milestone(row);
  });
}

export async function createMilestone(
  actor: string,
  projectId: string,
  value: MilestoneInput,
  requestKey: string,
): Promise<Milestone> {
  authorizePlanning(actor);
  planningId(projectId);
  const content = normalizedInput(value);
  const payload = { projectId, ...content };
  return planningAttempt<Milestone>(
    actor,
    'milestones_create',
    payload,
    requestKey,
    async () => {
      await projectRevision(projectId);
      const id = crypto.randomUUID();
      return planningMutation<Milestone>({
        actor,
        operation: 'milestones_create',
        payload,
        key: requestKey,
        guard: sql(
          'EXISTS (SELECT 1 FROM planning_projects WHERE id = ?)',
          projectId,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO planning_milestones(id, project_id, title, description, state, position, revision) SELECT ?, ?, ?, ?, 'open', COALESCE((SELECT MAX(position) + 1 FROM planning_milestones WHERE project_id = ?), 0), 0 WHERE ${gate.sql}`,
            id,
            projectId,
            content.title,
            content.description,
            projectId,
            ...(gate.params ?? []),
          ),
          sql(
            `UPDATE planning_projects SET planning_revision = planning_revision + 1 WHERE id = ? AND ${gate.sql}`,
            projectId,
            ...(gate.params ?? []),
          ),
        ],
        result: milestoneResult(projectId, id),
      });
    },
  );
}

export async function updateMilestone(
  actor: string,
  projectId: string,
  id: string,
  value: MilestoneInput,
  revision: number,
  requestKey: string,
): Promise<Milestone> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  expectedRevision(revision);
  const content = normalizedInput(value);
  const payload = { projectId, id, ...content, expectedRevision: revision };
  return planningAttempt<Milestone>(
    actor,
    'milestones_update',
    payload,
    requestKey,
    async () => {
      const current = await getMilestone(actor, projectId, id);
      if (current.revision !== revision || current.state !== 'open')
        throw new PlanningError(
          'conflict',
          'Dieser Milestone wurde geändert oder ist bereits geschlossen. Bitte neu laden.',
        );
      return planningMutation<Milestone>({
        actor,
        operation: 'milestones_update',
        payload,
        key: requestKey,
        guard: sql(
          "EXISTS (SELECT 1 FROM planning_milestones WHERE project_id = ? AND id = ? AND revision = ? AND state = 'open')",
          projectId,
          id,
          revision,
        ),
        writes: (gate) => [
          sql(
            `UPDATE planning_milestones SET title = ?, description = ?, revision = revision + 1 WHERE project_id = ? AND id = ? AND ${gate.sql}`,
            content.title,
            content.description,
            projectId,
            id,
            ...(gate.params ?? []),
          ),
          sql(
            `UPDATE planning_projects SET planning_revision = planning_revision + 1 WHERE id = ? AND ${gate.sql}`,
            projectId,
            ...(gate.params ?? []),
          ),
        ],
        result: milestoneResult(projectId, id),
      });
    },
  );
}

export async function moveMilestone(
  actor: string,
  projectId: string,
  id: string,
  beforeId: string | null,
  revision: number,
  requestKey: string,
): Promise<Milestone> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  if (beforeId !== null) planningId(beforeId);
  expectedRevision(revision);
  const payload = {
    projectId,
    id,
    beforeId,
    expectedPlanningRevision: revision,
  };
  return planningAttempt<Milestone>(
    actor,
    'milestones_move',
    payload,
    requestKey,
    async () => {
      const current = await getMilestone(actor, projectId, id);
      if (
        current.state !== 'open' ||
        beforeId === id ||
        (await projectRevision(projectId)) !== revision
      )
        throw new PlanningError(
          'conflict',
          'Die Milestone-Reihenfolge wurde geändert oder kann so nicht verschoben werden. Bitte neu laden.',
        );
      const { results } = await getD1()
        .prepare(
          'SELECT id FROM planning_milestones WHERE project_id = ? ORDER BY position, id',
        )
        .bind(projectId)
        .all<{ id: string }>();
      const orderedIds = results
        .map((row) => row.id)
        .filter((candidate) => candidate !== id);
      const target =
        beforeId === null ? orderedIds.length : orderedIds.indexOf(beforeId);
      if (target < 0)
        throw new PlanningError(
          'conflict',
          'Der gewählte Milestone gehört nicht zu dieser Reihenfolge. Bitte neu laden.',
        );
      orderedIds.splice(target, 0, id);
      const ids = JSON.stringify(orderedIds);
      return planningMutation<Milestone>({
        actor,
        operation: 'milestones_move',
        payload,
        key: requestKey,
        guard: sql(
          "EXISTS (SELECT 1 FROM planning_projects WHERE id = ? AND planning_revision = ?) AND EXISTS (SELECT 1 FROM planning_milestones WHERE project_id = ? AND id = ? AND state = 'open') AND (? IS NULL OR EXISTS (SELECT 1 FROM planning_milestones WHERE project_id = ? AND id = ?))",
          projectId,
          revision,
          projectId,
          id,
          beforeId,
          projectId,
          beforeId,
        ),
        writes: (gate) => [
          sql(
            `UPDATE planning_milestones SET position = CAST((SELECT key FROM json_each(?) WHERE value = planning_milestones.id) AS INTEGER), revision = revision + CASE WHEN id = ? THEN 1 ELSE 0 END WHERE project_id = ? AND ${gate.sql}`,
            ids,
            id,
            projectId,
            ...(gate.params ?? []),
          ),
          sql(
            `UPDATE planning_projects SET planning_revision = planning_revision + 1 WHERE id = ? AND ${gate.sql}`,
            projectId,
            ...(gate.params ?? []),
          ),
        ],
        result: milestoneResult(projectId, id),
      });
    },
  );
}
