import { getD1 } from '@/lib/data/d1';
import type { PageOptions } from '@/lib/domain/planning';

export class PlanningError extends Error {
  constructor(
    public readonly code:
      | 'validation'
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PlanningError';
  }
  get status() {
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
export type Sql = { sql: string; params?: (string | number | null)[] };
export const sql = (
  query: string,
  ...params: (string | number | null)[]
): Sql => ({ sql: query, params });
export function authorizePlanning(actor: string) {
  if (typeof actor !== 'string' || !actor.trim())
    throw new PlanningError('unauthorized', 'Bitte melde dich bei Luufi an.');
}
export function planningId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new PlanningError('validation', 'Die Kennung ist ungültig.');
}
export function expectedRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new PlanningError(
      'validation',
      'Eine gültige erwartete Revision ist erforderlich.',
    );
}
export function planningText(
  value: unknown,
  name: string,
  max = 4000,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new PlanningError(
      'validation',
      `${name} ist ungültig (höchstens ${max} Zeichen).`,
    );
  return value.trim();
}
export async function planningStorage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PlanningError) throw error;
    throw new PlanningError(
      'unavailable',
      'Die Projektplanung ist vorübergehend nicht verfügbar. Bitte versuche es erneut.',
    );
  }
}
function keyCheck(key: string) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
    throw new PlanningError(
      'validation',
      'Ein gültiger Wiederholungsschlüssel ist erforderlich.',
    );
}
type Receipt = {
  actor: string;
  operation: string;
  payload_json: string;
  result_json: string | null;
};
function decode<T>(
  row: Receipt,
  actor: string,
  operation: string,
  payload: string,
): T {
  if (
    row.actor !== actor ||
    row.operation !== operation ||
    row.payload_json !== payload ||
    row.result_json === null
  )
    throw new PlanningError(
      'conflict',
      'Dieser Wiederholungsschlüssel gehört zu einem anderen Inhalt.',
    );
  return JSON.parse(row.result_json) as T;
}
export async function planningReplay<T>(
  actor: string,
  operation: string,
  payload: unknown,
  key: string,
): Promise<T | undefined> {
  authorizePlanning(actor);
  keyCheck(key);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(
        'SELECT actor, operation, payload_json, result_json FROM planning_requests WHERE request_key = ?',
      )
      .bind(key)
      .first<Receipt>();
    return row
      ? decode<T>(row, actor, operation, JSON.stringify(payload))
      : undefined;
  });
}

/** An identical concurrent request may commit between the initial read and a
 * mutable precondition check. Re-read its receipt before returning that error. */
export async function planningAttempt<T>(
  actor: string,
  operation: string,
  payload: unknown,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const replay = await planningReplay<T>(actor, operation, payload, key);
  if (replay !== undefined) return replay;
  try {
    return await planningStorage(run);
  } catch (error) {
    if (
      error instanceof PlanningError &&
      ['conflict', 'not_found'].includes(error.code)
    ) {
      const concurrent = await planningReplay<T>(
        actor,
        operation,
        payload,
        key,
      );
      if (concurrent !== undefined) return concurrent;
    }
    throw error;
  }
}
/** Claim, guarded writes and original response form one atomic D1 batch. */
export async function planningMutation<T>(options: {
  actor: string;
  operation: string;
  payload: unknown;
  key: string;
  guard: Sql;
  writes: (gate: Sql) => Sql[];
  result: Sql;
}): Promise<T> {
  const { actor, operation, payload, key, guard, writes, result } = options;
  authorizePlanning(actor);
  keyCheck(key);
  return planningStorage(async () => {
    const db = getD1();
    const serialized = JSON.stringify(payload);
    const gate = sql(
      'EXISTS (SELECT 1 FROM planning_requests WHERE request_key = ? AND result_json IS NULL)',
      key,
    );
    const statements = [
      sql(
        `INSERT INTO planning_requests(request_key,actor,operation,payload_json) SELECT ?,?,?,? WHERE (${guard.sql}) AND NOT EXISTS (SELECT 1 FROM planning_requests WHERE request_key=?)`,
        key,
        actor,
        operation,
        serialized,
        ...(guard.params ?? []),
        key,
      ),
      ...writes(gate),
      // A missing response is an invariant failure: malformed JSON aborts the
      // whole transaction instead of committing data without its replay receipt.
      sql(
        `UPDATE planning_requests SET result_json=COALESCE((${result.sql}),json('missing-result')) WHERE request_key=? AND result_json IS NULL`,
        ...(result.params ?? []),
        key,
      ),
      sql(
        'SELECT actor,operation,payload_json,result_json FROM planning_requests WHERE request_key=?',
        key,
      ),
    ];
    const batch = await db.batch(
      statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))),
    );
    const row = batch.at(-1)!.results[0] as Receipt | undefined;
    if (row) return decode<T>(row, actor, operation, serialized);
    throw new PlanningError(
      'conflict',
      'Der Plan wurde inzwischen geändert oder die Voraussetzung ist nicht mehr erfüllt. Bitte neu laden.',
    );
  });
}
/** Cursor is bound to the exact filter and ordering revision. */
export function planningPage(
  options: PageOptions,
  scope: unknown,
  revision: number,
) {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new PlanningError(
      'validation',
      'Die Seitengröße muss zwischen 1 und 50 liegen.',
    );
  let offset = 0;
  if (options.cursor != null) {
    try {
      if (options.cursor.length > 2048) throw new Error();
      const value = JSON.parse(atob(options.cursor));
      if (
        JSON.stringify(value.scope) !== JSON.stringify(scope) ||
        !Number.isSafeInteger(value.offset) ||
        value.offset < 0
      )
        throw new Error();
      if (value.revision !== revision)
        throw new PlanningError(
          'conflict',
          'Die Reihenfolge wurde geändert. Bitte beginne die Liste erneut.',
        );
      offset = value.offset;
    } catch (error) {
      if (error instanceof PlanningError) throw error;
      throw new PlanningError(
        'validation',
        'Der Seitenverweis passt nicht zu dieser Liste.',
      );
    }
  }
  return {
    limit,
    offset,
    next: (hasMore: boolean) =>
      hasMore
        ? btoa(JSON.stringify({ scope, revision, offset: offset + limit }))
        : null,
  };
}
