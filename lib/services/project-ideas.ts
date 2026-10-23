import { getD1 } from '@/lib/data/d1';
import {
  validateProjectIdeaInput,
  type ProjectIdea,
  type ProjectIdeaPage,
} from '@/lib/domain/project-ideas';

export type ProjectIdeaErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable';
export class ProjectIdeaError extends Error {
  constructor(
    public readonly code: ProjectIdeaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectIdeaError';
  }
  get status(): number {
    return {
      validation: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      unavailable: 503,
    }[this.code];
  }
}

type IdeaRow = {
  id: string;
  idea_text: string;
  detail: string;
  created_at: number;
  revision: number;
};
type ReplayRow = {
  operation: string;
  payload_json: string;
  result_json: string;
};
export type DeletedProjectIdea = {
  id: string;
  deleted: true;
  revision: number;
};

function authorize(actor: string): void {
  if (typeof actor !== 'string' || !actor.trim()) {
    throw new ProjectIdeaError(
      'unauthorized',
      'Bitte melde dich bei Luufi an.',
    );
  }
}

function idea(row: IdeaRow): ProjectIdea {
  return {
    id: row.id,
    text: row.idea_text,
    detail: row.detail,
    createdAt: new Date(row.created_at).toISOString(),
    revision: row.revision,
  };
}

function identity(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id.length > 256) {
    throw new ProjectIdeaError(
      'not_found',
      'Diese Projektidee wurde nicht gefunden.',
    );
  }
}

function requestKey(key: string): void {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new ProjectIdeaError(
      'validation',
      'Ein gültiger Wiederholungsschlüssel ist erforderlich.',
    );
  }
}

function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProjectIdeaError(
      'validation',
      'Eine gültige erwartete Revision ist erforderlich.',
    );
  }
}

function input(value: unknown) {
  const validated = validateProjectIdeaInput(value);
  if (!validated.ok) throw new ProjectIdeaError('validation', validated.error);
  return validated.value;
}

async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProjectIdeaError) throw error;
    throw new ProjectIdeaError(
      'unavailable',
      'Die Projektideen sind vorübergehend nicht verfügbar. Bitte versuche es erneut.',
    );
  }
}

export async function listProjectIdeas(
  actor: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<ProjectIdeaPage> {
  authorize(actor);
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ProjectIdeaError(
      'validation',
      'Die Seitengröße muss zwischen 1 und 50 liegen.',
    );
  }
  let cursor: [number, string] | null = null;
  if (options.cursor !== undefined && options.cursor !== null) {
    try {
      if (options.cursor.length > 1024) throw new Error();
      const value: unknown = JSON.parse(atob(options.cursor));
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isSafeInteger(value[0]) ||
        typeof value[1] !== 'string' ||
        !value[1] ||
        value[1].length > 256
      )
        throw new Error();
      cursor = value as [number, string];
    } catch {
      throw new ProjectIdeaError(
        'validation',
        'Der Seitenverweis ist ungültig. Lade die Liste erneut.',
      );
    }
  }
  return storage(async () => {
    const db = getD1();
    const query = cursor
      ? db
          .prepare(
            'SELECT id, idea_text, detail, created_at, revision FROM project_ideas WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?',
          )
          .bind(cursor[0], cursor[0], cursor[1], limit + 1)
      : db
          .prepare(
            'SELECT id, idea_text, detail, created_at, revision FROM project_ideas ORDER BY created_at DESC, id DESC LIMIT ?',
          )
          .bind(limit + 1);
    const { results } = await query.all<IdeaRow>();
    const rows = results.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map(idea),
      nextCursor:
        results.length > limit && last
          ? btoa(JSON.stringify([last.created_at, last.id]))
          : null,
    };
  });
}

export async function getProjectIdea(
  actor: string,
  id: string,
): Promise<ProjectIdea> {
  authorize(actor);
  identity(id);
  return storage(async () => {
    const row = await getD1()
      .prepare(
        'SELECT id, idea_text, detail, created_at, revision FROM project_ideas WHERE id = ?',
      )
      .bind(id)
      .first<IdeaRow>();
    if (!row)
      throw new ProjectIdeaError(
        'not_found',
        'Diese Projektidee wurde nicht gefunden.',
      );
    return idea(row);
  });
}

// Every mutation and its replay receipt commit in one D1 transaction. The write
// checks both the requested revision and the absence of a prior request key.
async function mutate<T>(
  operation: string,
  payload: string,
  key: string,
  write: D1PreparedStatement,
  receipt: D1PreparedStatement,
  id: string,
): Promise<T> {
  return storage(async () => {
    const db = getD1();
    const results = await db.batch([
      write,
      receipt,
      db
        .prepare(
          'SELECT operation, payload_json, result_json FROM idea_mutation_requests WHERE request_key = ?',
        )
        .bind(key),
    ]);
    const row = results[2].results[0] as ReplayRow | undefined;
    if (row) {
      if (row.operation !== operation || row.payload_json !== payload) {
        throw new ProjectIdeaError(
          'conflict',
          'Dieser Wiederholungsschlüssel wurde bereits für einen anderen Inhalt verwendet.',
        );
      }
      return JSON.parse(row.result_json) as T;
    }
    const exists = await db
      .prepare('SELECT id FROM project_ideas WHERE id = ?')
      .bind(id)
      .first();
    if (!exists)
      throw new ProjectIdeaError(
        'not_found',
        'Diese Projektidee wurde nicht gefunden.',
      );
    throw new ProjectIdeaError(
      'conflict',
      'Die Projektidee wurde inzwischen geändert. Lade sie erneut und prüfe deine Änderung.',
    );
  });
}

export async function createProjectIdea(
  actor: string,
  value: unknown,
  key: string,
): Promise<ProjectIdea> {
  authorize(actor);
  requestKey(key);
  const content = input(value);
  return storage(async () => {
    const db = getD1();
    const created: ProjectIdea = {
      id: crypto.randomUUID(),
      ...content,
      createdAt: new Date().toISOString(),
      revision: 0,
    };
    const payload = JSON.stringify({ actor, ...content });
    return mutate<ProjectIdea>(
      'create',
      payload,
      key,
      db
        .prepare(
          'INSERT INTO project_ideas (id, idea_text, detail, created_at, revision) SELECT ?, ?, ?, ?, 0 WHERE NOT EXISTS (SELECT 1 FROM idea_mutation_requests WHERE request_key = ?)',
        )
        .bind(
          created.id,
          created.text,
          created.detail,
          Date.parse(created.createdAt),
          key,
        ),
      db
        .prepare(
          'INSERT INTO idea_mutation_requests (request_key, operation, payload_json, result_json) SELECT ?, ?, ?, ? WHERE changes() = 1',
        )
        .bind(key, 'create', payload, JSON.stringify(created)),
      created.id,
    );
  });
}

export async function updateProjectIdea(
  actor: string,
  id: string,
  value: unknown,
  expectedRevision: number,
  key: string,
): Promise<ProjectIdea> {
  authorize(actor);
  identity(id);
  revision(expectedRevision);
  requestKey(key);
  const content = input(value);
  return storage(async () => {
    const db = getD1();
    const payload = JSON.stringify({ actor, id, ...content, expectedRevision });
    return mutate<ProjectIdea>(
      'update',
      payload,
      key,
      db
        .prepare(
          'UPDATE project_ideas SET idea_text = ?, detail = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM idea_mutation_requests WHERE request_key = ?)',
        )
        .bind(content.text, content.detail, id, expectedRevision, key),
      db
        .prepare(
          "INSERT INTO idea_mutation_requests (request_key, operation, payload_json, result_json) SELECT ?, ?, ?, json_object('id', id, 'text', idea_text, 'detail', detail, 'createdAt', strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch'), 'revision', revision) FROM project_ideas WHERE id = ? AND changes() = 1",
        )
        .bind(key, 'update', payload, id),
      id,
    );
  });
}

export async function deleteProjectIdea(
  actor: string,
  id: string,
  expectedRevision: number,
  key: string,
): Promise<DeletedProjectIdea> {
  authorize(actor);
  identity(id);
  revision(expectedRevision);
  requestKey(key);
  return storage(async () => {
    const db = getD1();
    const payload = JSON.stringify({ actor, id, expectedRevision });
    const deleted: DeletedProjectIdea = {
      id,
      deleted: true,
      revision: expectedRevision,
    };
    return mutate<DeletedProjectIdea>(
      'delete',
      payload,
      key,
      db
        .prepare(
          'DELETE FROM project_ideas WHERE id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM idea_mutation_requests WHERE request_key = ?)',
        )
        .bind(id, expectedRevision, key),
      db
        .prepare(
          'INSERT INTO idea_mutation_requests (request_key, operation, payload_json, result_json) SELECT ?, ?, ?, ? WHERE changes() = 1',
        )
        .bind(key, 'delete', payload, JSON.stringify(deleted)),
      id,
    );
  });
}
