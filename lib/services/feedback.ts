import { getD1 } from '@/lib/data/d1';
import {
  attachmentMimeTypes,
  imageMaxBytes,
  videoMaxBytes,
  type AttachmentManifest,
  type Feedback,
  type FeedbackEntry,
  type FeedbackInput,
  type FeedbackSaved,
  type FeedbackSource,
  type FeedbackSummary,
  type Refinement,
  type RefinementInput,
} from '@/lib/domain/feedback';
import type { Page, PageOptions } from '@/lib/domain/planning';
import { entryJson, feedbackJson, refinementJson } from './feedback-sql';
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

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: unknown, allowed: string[]) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new PlanningError(
      'validation',
      'Die Eingabe enthält ungültige Felder.',
    );
}
function content(input: FeedbackInput) {
  fields(input, ['text', 'attachments']);
  if (typeof input.text !== 'string' || input.text.length > 20_000)
    throw new PlanningError(
      'validation',
      'Feedbacktext darf höchstens 20.000 Zeichen enthalten.',
    );
  const manifests = input.attachments === undefined ? [] : input.attachments;
  if (!Array.isArray(manifests) || manifests.length > 10)
    throw new PlanningError(
      'validation',
      'Pro Eintrag sind höchstens zehn Dateien erlaubt.',
    );
  const attachments = manifests.map((manifest): AttachmentManifest => {
    fields(manifest, ['name', 'mimeType', 'size']);
    if (
      typeof manifest.name !== 'string' ||
      !manifest.name.trim() ||
      manifest.name.length > 255 ||
      /[\p{Cc}/\\]/u.test(manifest.name)
    )
      throw new PlanningError('validation', 'Der Dateiname ist ungültig.');
    if (!attachmentMimeTypes.includes(manifest.mimeType))
      throw new PlanningError(
        'validation',
        'Dieser Dateityp wird nicht unterstützt.',
      );
    const maximum = manifest.mimeType.startsWith('image/')
      ? imageMaxBytes
      : videoMaxBytes;
    if (
      !Number.isSafeInteger(manifest.size) ||
      manifest.size <= 0 ||
      manifest.size > maximum
    )
      throw new PlanningError(
        'validation',
        'Die Dateigröße überschreitet die erlaubte Grenze.',
      );
    return {
      name: manifest.name,
      mimeType: manifest.mimeType,
      size: manifest.size,
    };
  });
  if (!input.text.trim() && attachments.length === 0)
    throw new PlanningError(
      'validation',
      'Bitte gib Text ein oder wähle mindestens eine Datei.',
    );
  // Exact original input is evidence: do not trim or normalize its contents.
  return { text: input.text, attachments };
}

type RefinementContent = Required<RefinementInput>;
function refinementInput(input: RefinementInput): RefinementContent {
  fields(input, [
    'repositoryCommit',
    'documentationPolicy',
    'planningPolicy',
    'summary',
    'orderIds',
    'questions',
    'deferredReason',
    'rejectedReason',
  ]);
  if (
    typeof input.repositoryCommit !== 'string' ||
    !/^[a-fA-F0-9]{40}$/.test(input.repositoryCommit)
  )
    throw new PlanningError(
      'validation',
      'Der gelesene Repository-Commit muss ein vollständiger SHA sein.',
    );
  const orderIds = input.orderIds === undefined ? [] : input.orderIds;
  const questions = input.questions === undefined ? [] : input.questions;
  if (
    !Array.isArray(orderIds) ||
    orderIds.length > 50 ||
    !Array.isArray(questions) ||
    questions.length > 50
  )
    throw new PlanningError(
      'validation',
      'Höchstens 50 Aufträge und 50 Fragen sind erlaubt.',
    );
  orderIds.forEach(planningId);
  const value = {
    repositoryCommit: input.repositoryCommit.toLowerCase(),
    documentationPolicy: planningText(
      input.documentationPolicy,
      'Dokumentationsrichtlinie',
      32,
      true,
    ),
    planningPolicy: planningText(
      input.planningPolicy,
      'Planungsrichtlinie',
      32,
      true,
    ),
    summary: planningText(input.summary, 'Refinement-Ergebnis', 4000, true),
    orderIds: [...new Set(orderIds)].sort(),
    questions: questions.map((question) =>
      planningText(question, 'Offene Frage', 2000, true),
    ),
    deferredReason: planningText(
      input.deferredReason === undefined ? '' : input.deferredReason,
      'Zurückstellungsgrund',
    ),
    rejectedReason: planningText(
      input.rejectedReason === undefined ? '' : input.rejectedReason,
      'Verwerfungsgrund',
    ),
  };
  if (
    !value.orderIds.length &&
    !value.questions.length &&
    !value.deferredReason &&
    !value.rejectedReason
  )
    throw new PlanningError(
      'validation',
      'Das Refinement benötigt Aufträge, offene Fragen oder eine begründete Entscheidung.',
    );
  return value;
}

const threadQuery = 'FROM feedback_threads f WHERE f.project_id=? AND f.id=?';
const threadResult = (projectId: string, id: string) =>
  sql(`SELECT ${feedbackJson()} ${threadQuery}`, projectId, id);
function savedResult(projectId: string, id: string, entryId: string) {
  return sql(
    `SELECT json_object('feedback',json(${feedbackJson()}),'entry',json((SELECT ${entryJson()} FROM feedback_entries e WHERE e.id=? AND e.feedback_id=f.id))) ${threadQuery}`,
    entryId,
    projectId,
    id,
  );
}
async function existsProject(projectId: string) {
  if (
    !(await getD1()
      .prepare('SELECT 1 FROM planning_projects WHERE id=?')
      .bind(projectId)
      .first())
  )
    throw new PlanningError(
      'not_found',
      'Dieses Projekt wurde nicht gefunden.',
    );
}
const projectRevisionSql = (projectId: string) =>
  sql(
    'SELECT COALESCE(SUM(revision+1),0) AS revision FROM feedback_threads WHERE project_id=?',
    projectId,
  );
const threadRevisionSql = (projectId: string, id: string) =>
  sql(
    'SELECT revision FROM feedback_threads WHERE project_id=? AND id=?',
    projectId,
    id,
  );
async function revision(query: Sql) {
  const row = await getD1()
    .prepare(query.sql)
    .bind(...query.params!)
    .first<{ revision: number }>();
  if (!row)
    throw new PlanningError(
      'not_found',
      'Dieses Feedback wurde nicht gefunden.',
    );
  return row.revision;
}
async function paginated<T>(
  options: PageOptions,
  scope: unknown,
  version: Sql,
  rows: Sql,
): Promise<Page<T>> {
  const current = await revision(version);
  const page = planningPage(options, scope, current);
  const db = getD1();
  const snapshot = await db.batch([
    db
      .prepare(`${rows.sql} LIMIT ? OFFSET ?`)
      .bind(...(rows.params ?? []), page.limit + 1, page.offset),
    db.prepare(version.sql).bind(...(version.params ?? [])),
  ]);
  if (
    (snapshot[1].results[0] as { revision: number } | undefined)?.revision !==
    current
  )
    throw new PlanningError(
      'conflict',
      'Das Feedback wurde geändert. Bitte beginne die Liste erneut.',
    );
  const results = snapshot[0].results as { data: string }[];
  return {
    items: results.slice(0, page.limit).map((row) => JSON.parse(row.data) as T),
    nextCursor: page.next(results.length > page.limit),
  };
}
export async function getFeedback(
  actor: string,
  projectId: string,
  id: string,
): Promise<Feedback> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(`SELECT ${feedbackJson()} AS data ${threadQuery}`)
      .bind(projectId, id)
      .first<{ data: string }>();
    if (!row)
      throw new PlanningError(
        'not_found',
        'Dieses Feedback wurde nicht gefunden.',
      );
    return JSON.parse(row.data) as Feedback;
  });
}
export async function listFeedback(
  actor: string,
  projectId: string,
  options: PageOptions = {},
): Promise<Page<FeedbackSummary>> {
  authorizePlanning(actor);
  planningId(projectId);
  return planningStorage(async () => {
    await existsProject(projectId);
    return paginated(
      options,
      { kind: 'feedback', projectId },
      projectRevisionSql(projectId),
      sql(
        `SELECT json_patch(${feedbackJson()},json_object('originalPreview',COALESCE((SELECT substr(text,1,280) FROM feedback_entries WHERE feedback_id=f.id AND kind='original'),''),'entryCount',(SELECT COUNT(*) FROM feedback_entries WHERE feedback_id=f.id),'attachmentCount',(SELECT COUNT(*) FROM feedback_attachments WHERE feedback_id=f.id),'pendingAttachmentCount',(SELECT COUNT(*) FROM feedback_attachments WHERE feedback_id=f.id AND status!='ready'))) AS data FROM feedback_threads f WHERE f.project_id=? ORDER BY f.updated_at DESC,f.id`,
        projectId,
      ),
    );
  });
}
export async function listFeedbackEntries(
  actor: string,
  projectId: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<FeedbackEntry>> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  return planningStorage(() =>
    paginated(
      options,
      { kind: 'feedbackEntries', projectId, id },
      threadRevisionSql(projectId, id),
      sql(
        `SELECT ${entryJson()} AS data FROM feedback_entries e WHERE e.feedback_id=? ORDER BY e.position,e.id`,
        id,
      ),
    ),
  );
}
export async function listFeedbackRefinements(
  actor: string,
  projectId: string,
  id: string,
  options: PageOptions = {},
): Promise<Page<Refinement>> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  return planningStorage(() =>
    paginated(
      options,
      { kind: 'feedbackRefinements', projectId, id },
      threadRevisionSql(projectId, id),
      sql(
        `SELECT ${refinementJson()} AS data FROM feedback_refinements r WHERE r.feedback_id=? ORDER BY r.created_at,r.id`,
        id,
      ),
    ),
  );
}
export async function listOrderFeedbackSources(
  actor: string,
  projectId: string,
  orderId: string,
  options: PageOptions = {},
): Promise<Page<FeedbackSource>> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(orderId);
  return planningStorage(async () => {
    if (
      !(await getD1()
        .prepare('SELECT 1 FROM planning_orders WHERE project_id=? AND id=?')
        .bind(projectId, orderId)
        .first())
    )
      throw new PlanningError(
        'not_found',
        'Dieser Auftrag wurde nicht gefunden.',
      );
    return paginated(
      options,
      { kind: 'orderFeedbackSources', projectId, orderId },
      projectRevisionSql(projectId),
      sql(
        `SELECT json_object('feedbackId',r.feedback_id,'refinementId',r.id,'inputContentRevision',r.input_content_revision,'summary',json_extract(r.input_json,'$.summary'),'createdAt',r.created_at) AS data FROM feedback_order_sources s JOIN feedback_refinements r ON r.id=s.refinement_id JOIN feedback_threads f ON f.id=r.feedback_id WHERE s.order_id=? AND f.project_id=? ORDER BY r.created_at,r.id`,
        orderId,
        projectId,
      ),
    );
  });
}
function slots(
  gate: Sql,
  projectId: string,
  feedbackId: string,
  entryId: string,
  createdAt: string,
  manifests: AttachmentManifest[],
) {
  return manifests.map((manifest, position) =>
    sql(
      `INSERT INTO feedback_attachments(id,project_id,feedback_id,entry_id,filename,declared_mime_type,declared_size,position,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
      crypto.randomUUID(),
      projectId,
      feedbackId,
      entryId,
      manifest.name,
      manifest.mimeType,
      manifest.size,
      position,
      createdAt,
      ...gate.params!,
    ),
  );
}
export async function createFeedback(
  actor: string,
  projectId: string,
  input: FeedbackInput,
  requestKey: string,
): Promise<FeedbackSaved> {
  authorizePlanning(actor);
  planningId(projectId);
  const value = content(input),
    payload = { projectId, ...value };
  return planningAttempt(
    actor,
    'feedback.create',
    payload,
    requestKey,
    async () => {
      await existsProject(projectId);
      const id = crypto.randomUUID(),
        entryId = crypto.randomUUID(),
        now = new Date().toISOString();
      return planningMutation({
        actor,
        operation: 'feedback.create',
        payload,
        key: requestKey,
        guard: sql(
          'EXISTS(SELECT 1 FROM planning_projects WHERE id=?)',
          projectId,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO feedback_threads(id,project_id,created_at,updated_at) SELECT ?,?,?,? WHERE ${gate.sql}`,
            id,
            projectId,
            now,
            now,
            ...gate.params!,
          ),
          sql(
            `INSERT INTO feedback_entries(id,feedback_id,kind,text,position,created_at) SELECT ?,?,'original',?,0,? WHERE ${gate.sql}`,
            entryId,
            id,
            value.text,
            now,
            ...gate.params!,
          ),
          ...slots(gate, projectId, id, entryId, now, value.attachments),
        ],
        result: savedResult(projectId, id, entryId),
      });
    },
  );
}
export async function appendFeedback(
  actor: string,
  projectId: string,
  id: string,
  input: FeedbackInput,
  revision: number,
  requestKey: string,
): Promise<FeedbackSaved> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  expectedRevision(revision);
  const value = content(input),
    payload = { projectId, id, ...value, expectedRevision: revision };
  return planningAttempt(
    actor,
    'feedback.append',
    payload,
    requestKey,
    async () => {
      await getFeedback(actor, projectId, id);
      const entryId = crypto.randomUUID(),
        now = new Date().toISOString();
      return planningMutation({
        actor,
        operation: 'feedback.append',
        payload,
        key: requestKey,
        guard: sql(
          'EXISTS(SELECT 1 FROM feedback_threads WHERE project_id=? AND id=? AND revision=?)',
          projectId,
          id,
          revision,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO feedback_entries(id,feedback_id,kind,text,position,created_at) SELECT ?,id,'addition',?,next_entry_position,? FROM feedback_threads WHERE id=? AND ${gate.sql}`,
            entryId,
            value.text,
            now,
            id,
            ...gate.params!,
          ),
          ...slots(gate, projectId, id, entryId, now, value.attachments),
          sql(
            `UPDATE feedback_threads SET revision=revision+1,content_revision=content_revision+1,next_entry_position=next_entry_position+1,updated_at=? WHERE id=? AND ${gate.sql}`,
            now,
            id,
            ...gate.params!,
          ),
        ],
        result: savedResult(projectId, id, entryId),
      });
    },
  );
}
export async function refineFeedback(
  actor: string,
  projectId: string,
  id: string,
  input: RefinementInput,
  revision: number,
  requestKey: string,
): Promise<Feedback> {
  authorizePlanning(actor);
  planningId(projectId);
  planningId(id);
  expectedRevision(revision);
  const value = refinementInput(input),
    payload = { projectId, id, ...value, expectedRevision: revision };
  return planningAttempt(
    actor,
    'feedback.refine',
    payload,
    requestKey,
    async () => {
      await getFeedback(actor, projectId, id);
      const refinementId = crypto.randomUUID(),
        now = new Date().toISOString(),
        orders = JSON.stringify(value.orderIds);
      const referenced = await getD1()
        .prepare(
          'SELECT id,project_id FROM planning_orders WHERE id IN (SELECT value FROM json_each(?))',
        )
        .bind(orders)
        .all<{ id: string; project_id: string }>();
      if (referenced.results.length !== value.orderIds.length)
        throw new PlanningError(
          'not_found',
          'Ein referenzierter Auftrag wurde nicht gefunden.',
        );
      if (referenced.results.some((order) => order.project_id !== projectId))
        throw new PlanningError(
          'conflict',
          'Alle referenzierten Aufträge müssen zu diesem Projekt gehören.',
        );
      return planningMutation({
        actor,
        operation: 'feedback.refine',
        payload,
        key: requestKey,
        guard: sql(
          `EXISTS(SELECT 1 FROM feedback_threads WHERE project_id=? AND id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) refs WHERE NOT EXISTS(SELECT 1 FROM planning_orders o WHERE o.id=refs.value AND o.project_id=?))`,
          projectId,
          id,
          revision,
          orders,
          projectId,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO feedback_refinements(id,feedback_id,input_content_revision,input_json,created_at) SELECT ?,id,content_revision,?,? FROM feedback_threads WHERE id=? AND ${gate.sql}`,
            refinementId,
            JSON.stringify(value),
            now,
            id,
            ...gate.params!,
          ),
          sql(
            `INSERT INTO feedback_order_sources(refinement_id,feedback_id,order_id) SELECT ?,?,value FROM json_each(?) WHERE ${gate.sql}`,
            refinementId,
            id,
            orders,
            ...gate.params!,
          ),
          sql(
            `UPDATE feedback_threads SET revision=revision+1,refined_content_revision=content_revision,updated_at=? WHERE id=? AND ${gate.sql}`,
            now,
            id,
            ...gate.params!,
          ),
        ],
        result: threadResult(projectId, id),
      });
    },
  );
}
