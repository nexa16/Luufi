type ProbeRow = { revision: number; value: string };
type WriteRow = ProbeRow & { expected_revision: number };

export async function readProbe(db: D1Database, ownerId: string) {
  return db
    .prepare(
      'SELECT revision, value FROM luufi_mcp_probe_records WHERE owner_id = ?',
    )
    .bind(ownerId)
    .first<ProbeRow>();
}

/** Both statements execute in one D1 transaction; stale requests cannot write. */
export async function writeProbe(
  db: D1Database,
  ownerId: string,
  input: { expectedRevision: number; value: string; requestKey: string },
) {
  const { expectedRevision, value, requestKey } = input;
  const results = await db.batch([
    db
      .prepare(`INSERT INTO luufi_mcp_probe_writes
      (owner_id, request_key, expected_revision, revision, value)
      SELECT ?, ?, ?, ? + 1, ?
      WHERE ? = COALESCE((SELECT revision FROM luufi_mcp_probe_records WHERE owner_id = ?), 0)
      ON CONFLICT(owner_id, request_key) DO NOTHING`)
      .bind(
        ownerId,
        requestKey,
        expectedRevision,
        expectedRevision,
        value,
        expectedRevision,
        ownerId,
      ),
    db
      .prepare(`INSERT INTO luufi_mcp_probe_records (owner_id, revision, value)
      SELECT ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM luufi_mcp_probe_writes
        WHERE owner_id = ? AND request_key = ? AND expected_revision = ? AND value = ?)
      ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, value = excluded.value
      WHERE luufi_mcp_probe_records.revision = ?`)
      .bind(
        ownerId,
        expectedRevision + 1,
        value,
        ownerId,
        requestKey,
        expectedRevision,
        value,
        expectedRevision,
      ),
  ]);
  const recorded = await db
    .prepare(`SELECT expected_revision, revision, value
    FROM luufi_mcp_probe_writes WHERE owner_id = ? AND request_key = ?`)
    .bind(ownerId, requestKey)
    .first<WriteRow>();
  if (!recorded)
    throw Object.assign(new Error('Conflict'), { code: 'REVISION_CONFLICT' });
  if (
    recorded.expected_revision !== expectedRevision ||
    recorded.value !== value
  ) {
    throw Object.assign(new Error('Conflict'), {
      code: 'REQUEST_KEY_CONFLICT',
    });
  }
  return {
    revision: recorded.revision,
    value: recorded.value,
    replayed: results[0].meta.changes === 0,
  };
}
