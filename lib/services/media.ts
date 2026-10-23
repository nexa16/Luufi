import { env } from 'cloudflare:workers';
import { getD1 } from '@/lib/data/d1';
import type { Attachment } from '@/lib/domain/feedback';
import { MediaValidationError, validateMedia } from '@/lib/domain/media';
import { attachmentJson } from './feedback-sql';
import {
  authorizePlanning,
  expectedRevision,
  planningAttempt,
  planningId,
  planningMutation,
  planningStorage,
  PlanningError,
  sql,
} from './planning-store';

type Stored = {
  data: string;
  object_key: string | null;
  declared_mime_type: string;
  declared_size: number;
};
const bucket = () => {
  if (!env.BUCKET)
    throw new PlanningError(
      'unavailable',
      'Der Dateispeicher ist vorübergehend nicht verfügbar.',
    );
  return env.BUCKET;
};
function scope(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
) {
  authorizePlanning(actor);
  [projectId, feedbackId, id].forEach(planningId);
}
async function stored(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
): Promise<Stored> {
  scope(actor, projectId, feedbackId, id);
  return planningStorage(async () => {
    const row = await getD1()
      .prepare(
        `SELECT ${attachmentJson()} AS data,a.object_key,a.declared_mime_type,a.declared_size FROM feedback_attachments a JOIN feedback_threads f ON f.id=a.feedback_id AND f.project_id=a.project_id WHERE a.id=? AND a.project_id=? AND a.feedback_id=?`,
      )
      .bind(id, projectId, feedbackId)
      .first<Stored>();
    if (!row)
      throw new PlanningError('not_found', 'Der Anhang wurde nicht gefunden.');
    return row;
  });
}
export async function getAttachment(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
): Promise<Attachment> {
  return JSON.parse((await stored(actor, projectId, feedbackId, id)).data);
}
const hash = async (b: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(b).buffer),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
export async function uploadAttachment(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
  bytes: Uint8Array,
  revision: number,
  requestKey: string,
): Promise<Attachment> {
  scope(actor, projectId, feedbackId, id);
  expectedRevision(revision);
  if (!(bytes instanceof Uint8Array) || bytes.length > 15_000_000)
    throw new PlanningError(
      'validation',
      'Die Datei ist zu groß oder ungültig.',
    );
  const sha256 = await hash(bytes),
    payload = {
      projectId,
      feedbackId,
      id,
      revision,
      sha256,
      size: bytes.length,
    };
  return planningAttempt(
    actor,
    'media.upload',
    payload,
    requestKey,
    async () => {
      const row = await stored(actor, projectId, feedbackId, id),
        attachment: Attachment = JSON.parse(row.data);
      if (attachment.status === 'ready' || attachment.revision !== revision)
        throw new PlanningError(
          'conflict',
          'Der Anhang wurde inzwischen geändert. Bitte neu laden.',
        );
      let mime: string;
      try {
        mime = validateMedia(bytes, row.declared_mime_type, row.declared_size);
      } catch (error) {
        if (error instanceof MediaValidationError)
          throw new PlanningError('validation', error.message);
        throw error;
      }
      const now = new Date().toISOString(),
        key = `feedback-media/${now}/${crypto.randomUUID()}`;
      let committed = false;
      try {
        await bucket().put(key, bytes, { httpMetadata: { contentType: mime } });
        const result = await planningMutation<Attachment>({
          actor,
          operation: 'media.upload',
          payload,
          key: requestKey,
          guard: sql(
            `EXISTS(SELECT 1 FROM feedback_attachments WHERE id=? AND project_id=? AND feedback_id=? AND revision=? AND status IN ('pending','expired')) AND julianday('now')-julianday(?)<1`,
            id,
            projectId,
            feedbackId,
            revision,
            now,
          ),
          writes: (gate) => [
            sql(
              `UPDATE feedback_attachments SET status='ready',revision=revision+1,object_key=?,actual_mime_type=?,actual_size=?,sha256=?,ready_at=? WHERE id=? AND (${gate.sql})`,
              key,
              mime,
              bytes.length,
              sha256,
              now,
              id,
              ...gate.params!,
            ),
            sql(
              `UPDATE feedback_threads SET revision=revision+1,content_revision=content_revision+1,updated_at=? WHERE id=? AND project_id=? AND (${gate.sql})`,
              now,
              feedbackId,
              projectId,
              ...gate.params!,
            ),
          ],
          result: sql(
            `SELECT ${attachmentJson()} FROM feedback_attachments a WHERE a.id=?`,
            id,
          ),
        });
        // A concurrent identical replay can return another attempt's winning object.
        const current = await stored(actor, projectId, feedbackId, id);
        committed = current.object_key === key;
        return result;
      } finally {
        if (!committed) {
          // Even an ambiguous D1 response must never delete a committed object.
          try {
            const reference = await getD1()
              .prepare(
                "SELECT 1 FROM feedback_attachments WHERE object_key=? AND status='ready'",
              )
              .bind(key)
              .first();
            if (!reference) await bucket().delete(key);
          } catch {
            /* 24h orphan cleanup handles unavailable storage. */
          }
        }
      }
    },
  );
}
export async function attachmentObject(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
  range?: R2Range,
) {
  const row = await stored(actor, projectId, feedbackId, id),
    attachment: Attachment = JSON.parse(row.data);
  if (attachment.status !== 'ready' || !row.object_key)
    throw new PlanningError(
      'conflict',
      'Dieser Anhang ist noch nicht vollständig gespeichert.',
    );
  const object = await planningStorage(() =>
    bucket().get(row.object_key!, range ? { range } : undefined),
  );
  if (!object || object.size !== attachment.size)
    throw new PlanningError(
      'unavailable',
      'Die gespeicherte Datei ist vorübergehend nicht verfügbar.',
    );
  return { attachment, object };
}
export async function readAttachment(
  actor: string,
  projectId: string,
  feedbackId: string,
  id: string,
  offset: number,
  length: number,
) {
  scope(actor, projectId, feedbackId, id);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(length) ||
    length < 1 ||
    length > 65536
  )
    throw new PlanningError(
      'validation',
      'Der Dateiausschnitt ist ungültig (höchstens 65536 Bytes).',
    );
  const attachment = await getAttachment(actor, projectId, feedbackId, id);
  if (offset >= attachment.size)
    throw new PlanningError(
      'validation',
      'Der Dateiausschnitt liegt außerhalb der Datei.',
    );
  const { object } = await attachmentObject(actor, projectId, feedbackId, id, {
    offset,
    length: Math.min(length, attachment.size - offset),
  });
  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return {
    attachment,
    offset,
    byteLength: bytes.length,
    base64: btoa(binary),
    sha256: attachment.sha256,
    totalBytes: attachment.size,
  };
}
type CleanupReceipt = {
  expired: number;
  deletedOrphans: number;
  keys: string[];
  cursor: string | null;
};
async function unreferenced(keys: string[]) {
  if (!keys.length) return keys;
  const references = await getD1()
    .prepare(
      "SELECT object_key FROM feedback_attachments WHERE status='ready' AND object_key IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(keys))
    .all<{ object_key: string }>();
  const referenced = new Set(references.results.map((row) => row.object_key));
  return keys.filter((key) => !referenced.has(key));
}
export async function cleanupAttachments(
  actor: string,
  limit: number,
  requestKey: string,
): Promise<{ expired: number; deletedOrphans: number }> {
  authorizePlanning(actor);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new PlanningError(
      'validation',
      'Die Bereinigungsgrenze muss zwischen 1 und 50 liegen.',
    );
  const result = await planningAttempt<CleanupReceipt>(
    actor,
    'media.cleanup',
    { limit },
    requestKey,
    async () => {
      const cutoff = new Date(Date.now() - 86_400_000).toISOString();
      const previous = await getD1()
        .prepare(
          "SELECT result_json FROM planning_requests WHERE operation='media.cleanup' AND result_json IS NOT NULL ORDER BY rowid DESC LIMIT 1",
        )
        .first<{ result_json: string }>();
      const cursor = previous
        ? (JSON.parse(previous.result_json).cursor as string | null)
        : null;
      const objects = await bucket().list({
        prefix: 'feedback-media/',
        limit,
        cursor: cursor ?? undefined,
      });
      const keys = await unreferenced(
        objects.objects
          .filter((object) => object.uploaded.toISOString() < cutoff)
          .map((object) => object.key),
      );
      const pending = await getD1()
        .prepare(
          "SELECT id,feedback_id,revision FROM feedback_attachments WHERE status='pending' AND created_at<? ORDER BY created_at,id LIMIT ?",
        )
        .bind(cutoff, limit)
        .all<{ id: string; feedback_id: string; revision: number }>();
      const ids = JSON.stringify(pending.results.map((r) => r.id));
      const receipt: CleanupReceipt = {
        expired: pending.results.length,
        deletedOrphans: keys.length,
        keys,
        cursor: objects.truncated ? objects.cursor : null,
      };
      return planningMutation<CleanupReceipt>({
        actor,
        operation: 'media.cleanup',
        payload: { limit },
        key: requestKey,
        guard: sql(
          `(SELECT count(*) FROM feedback_attachments WHERE status='pending' AND created_at<? AND id IN (SELECT value FROM json_each(?)))=?`,
          cutoff,
          ids,
          pending.results.length,
        ),
        writes: (gate) => [
          sql(
            `UPDATE feedback_threads SET revision=revision+(SELECT count(*) FROM feedback_attachments a WHERE a.feedback_id=feedback_threads.id AND a.id IN (SELECT value FROM json_each(?))),updated_at=? WHERE id IN (SELECT feedback_id FROM feedback_attachments WHERE id IN (SELECT value FROM json_each(?))) AND (${gate.sql})`,
            ids,
            new Date().toISOString(),
            ids,
            ...gate.params!,
          ),
          sql(
            `UPDATE feedback_attachments SET status='expired',revision=revision+1 WHERE id IN (SELECT value FROM json_each(?)) AND (${gate.sql})`,
            ids,
            ...gate.params!,
          ),
        ],
        result: sql('SELECT ?', JSON.stringify(receipt)),
      });
    },
  );
  // Persisted deletion plan makes retry safe even after a partial R2 failure.
  await planningStorage(async () => {
    const keys = await unreferenced(result.keys);
    if (keys.length) await bucket().delete(keys);
  });
  return { expired: result.expired, deletedOrphans: result.deletedOrphans };
}
