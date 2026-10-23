import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  excludedLegacyTables,
  makeRecoverySnapshot,
  recoveryTables,
  verifyRecovery,
} from './verify-recovery.mjs';
const directories: string[] = [],
  migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
function fixture(media = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'luufi-recovery-'));
  directories.push(dir);
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(path.join(migrations, name), 'utf8'));
  db.prepare(
    'INSERT INTO project_ideas(id,idea_text,detail,created_at,revision) VALUES(?,?,?,?,?)',
  ).run(
    'original-id',
    '  Exakter\r\nOriginaltext 👩‍💻  ',
    'Unverändertes Detail',
    123456789,
    2,
  );
  db.prepare('INSERT INTO idea_mutation_requests VALUES(?,?,?,?)').run(
    'idea-key',
    'create',
    '{"original":"private-test"}',
    '{"id":"original-id"}',
  );
  db.prepare('INSERT INTO luufi_mcp_probe_records VALUES(?,?,?)').run(
    'owner',
    1,
    'synthetische Probe',
  );
  db.prepare('INSERT INTO luufi_mcp_probe_writes VALUES(?,?,?,?,?)').run(
    'owner',
    'probe-key',
    0,
    1,
    'synthetische Probe',
  );
  // Old schema exists after migrations; excluded credentials must remain empty in restore.
  db.prepare(
    'INSERT INTO oauth_sessions(session_hash,encrypted_tokens,scopes,owner_login,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  ).run('legacy-session', 'SECRET_NOT_RESTORED', 'repo', 'legacy', 1, 1, 1);
  const raw: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    recoveryTables.map((table: string) => [table, []]),
  );
  const attachments: {
    attachmentId: string;
    objectKey: string;
    relativePath: string;
    size: number;
    sha256: string;
  }[] = [];
  if (media) {
    db.exec(
      "INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints) VALUES('p','DEMO','Demo','example/demo','develop','main','[]',''); INSERT INTO feedback_threads(id,project_id,created_at,updated_at) VALUES('f','p','2026-10-23T10:00:00.000Z','2026-10-23T10:00:00.000Z'); INSERT INTO feedback_entries(id,feedback_id,kind,text,position,created_at) VALUES('e','f','original','Dateien',0,'2026-10-23T10:00:00.000Z')",
    );
    db.prepare(
      "INSERT INTO feedback_attachments(id,project_id,feedback_id,entry_id,filename,declared_mime_type,declared_size,position,status,object_key,actual_mime_type,actual_size,sha256,created_at,ready_at) VALUES('a','p','f','e','Bild.png','image/png',?,0,'ready','feedback-media/synthetic','image/png',?,?,?,?)",
    ).run(
      png.length,
      png.length,
      hash(png),
      '2026-10-23T10:00:00.000Z',
      '2026-10-23T10:01:00.000Z',
    );
    db.prepare(
      "INSERT INTO feedback_attachments(id,project_id,feedback_id,entry_id,filename,declared_mime_type,declared_size,position,status,created_at) VALUES('pending','p','f','e','Fehlt.png','image/png',?,1,'pending',?)",
    ).run(png.length, '2026-10-23T10:00:00.000Z');
    mkdirSync(path.join(dir, 'media'));
    writeFileSync(path.join(dir, 'media', 'a.png'), png);
    attachments.push({
      attachmentId: 'a',
      objectKey: 'feedback-media/synthetic',
      relativePath: 'media/a.png',
      size: png.length,
      sha256: hash(png),
    });
  }
  for (const table of recoveryTables)
    raw[table] = db.prepare(`SELECT * FROM "${table}"`).all();
  db.close();
  const snapshot = makeRecoverySnapshot({
    environment: 'local',
    capturedAt: '2026-10-23T10:00:00.000Z',
    tables: raw,
    attachments,
  });
  const snapshotPath = path.join(dir, 'snapshot.json'),
    targetPath = path.join(dir, 'new.sqlite');
  const save = () => writeFileSync(snapshotPath, JSON.stringify(snapshot));
  save();
  return { dir, raw, snapshot, snapshotPath, targetPath, save };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function referenceFixture() {
  const f = fixture(true),
    now = '2026-10-23T10:00:00.000Z',
    commit = 'a'.repeat(40);
  f.raw.planning_orders = [
    {
      id: 'o',
      project_id: 'p',
      number: 1,
      type: 'feature',
      status: 'done',
      spec_version: 1,
      revision: 0,
      milestone_id: null,
      position: 0,
      lifecycle_revision: 0,
      current_implementation_id: 'impl',
      integration_id: 'integration',
    },
  ];
  f.raw.planning_order_versions = [
    {
      order_id: 'o',
      version: 1,
      spec_json: '{"title":"Test"}',
      created_at: now,
    },
  ];
  f.raw.order_approvals = [
    {
      id: 'approval',
      project_id: 'p',
      revision: 0,
      mode: 'selection',
      milestone_id: null,
      confirmation_reference: 'synthetic',
      created_at: now,
      revoked_at: null,
    },
  ];
  f.raw.order_approval_items = [
    {
      approval_id: 'approval',
      order_id: 'o',
      spec_version: 1,
      title: 'Test',
      dependency_ids_json: '[]',
      repository: 'example/demo',
      integration_branch: 'develop',
      invalidated_at: null,
      invalidated_reason: '',
    },
  ];
  f.raw.order_executions = [
    {
      id: 'exec',
      project_id: 'p',
      order_id: 'o',
      spec_version: 1,
      approval_id: 'approval',
      worker: 'agent',
      branch: 'codex/test',
      generation: 1,
      revision: 0,
      phase: 'closed',
      created_at: now,
      updated_at: now,
    },
  ];
  f.raw.order_evidence = ['validation', 'impl', 'integration'].map((id) => ({
    id,
    order_id: 'o',
    spec_version: 1,
    kind: id === 'impl' ? 'implementation' : id,
    outcome: 'success',
    execution_id: 'exec',
    generation: 1,
    payload_json: JSON.stringify({
      validationId: id === 'validation' ? null : 'validation',
    }),
    supersedes_id: null,
    created_at: now,
  }));
  f.raw.project_versions = [
    {
      id: 'v',
      project_id: 'p',
      label: 'fixture',
      channel: 'production',
      title: 'Test',
      changelog: 'synthetic',
      repository_commit: commit,
      source_branch: 'main',
      revision: 0,
      release_id: 'release',
      created_at: now,
    },
  ];
  f.raw.version_orders = [
    {
      id: 'vo',
      version_id: 'v',
      order_id: 'o',
      display_id: 'DEMO-1',
      title: 'Test',
      spec_version: 1,
      implementation_id: 'impl',
      integration_id: 'integration',
      implementation_commit: commit,
      integration_reference: 'synthetic',
      provenance_kind: 'execution',
    },
  ];
  f.raw.version_builds = [
    {
      id: 'build',
      version_id: 'v',
      kind: 'site',
      environment: 'production',
      outcome: 'available',
      payload_json: '{}',
      observed_at: now,
      created_at: now,
    },
  ];
  f.raw.version_releases = [
    {
      id: 'release',
      version_id: 'v',
      project_id: 'p',
      tag: 'test-v1',
      payload_json: JSON.stringify({ buildId: 'build' }),
      created_at: now,
    },
  ];
  const save = () =>
    writeFileSync(
      f.snapshotPath,
      JSON.stringify(
        makeRecoverySnapshot({
          environment: 'local',
          tables: f.raw,
          attachments: f.snapshot.attachments,
        }),
      ),
    );
  save();
  return { ...f, save };
}
it('stellt vollständige Release-/Build- und Nachweisketten wieder her', () => {
  const f = referenceFixture();
  expect(verifyRecovery(f).ok).toBe(true);
});
it.each([
  'missing-build',
  'other-version-build',
  'missing-validation',
  'wrong-kind-validation',
  'other-generation-validation',
  'version-implementation',
  'version-integration',
  'current-implementation',
  'current-integration',
  'current-release',
  'current-spec',
])('verweigert unvollständige oder fremde Referenz %s', (kind) => {
  const f = referenceFixture();
  if (kind === 'missing-build') f.raw.version_builds = [];
  if (kind === 'other-version-build') {
    f.raw.project_versions.push({
      ...f.raw.project_versions[0],
      id: 'v2',
      label: 'other',
      release_id: null,
    });
    f.raw.version_builds[0].version_id = 'v2';
  }
  if (kind === 'missing-validation')
    f.raw.order_evidence[1].payload_json = '{"validationId":"missing"}';
  if (kind === 'wrong-kind-validation')
    f.raw.order_evidence[1].payload_json = '{"validationId":"integration"}';
  if (kind === 'other-generation-validation')
    f.raw.order_evidence[0].generation = 0;
  if (kind === 'version-implementation')
    f.raw.version_orders[0].implementation_id = 'missing';
  if (kind === 'version-integration')
    f.raw.version_orders[0].integration_id = 'missing';
  if (kind === 'current-implementation')
    f.raw.planning_orders[0].current_implementation_id = 'missing';
  if (kind === 'current-integration')
    f.raw.planning_orders[0].integration_id = 'missing';
  if (kind === 'current-release')
    f.raw.project_versions[0].release_id = 'missing';
  if (kind === 'current-spec') f.raw.planning_orders[0].spec_version = 2;
  f.save();
  expect(() => verifyRecovery(f)).toThrow(/referenzen/i);
  expect(existsSync(f.targetPath)).toBe(false);
});
it('stellt alle vollständigen Kernrows mit Originaltext/IDs/Zeiten/Replay wieder her und lässt alte Credentials leer', () => {
  const f = fixture(),
    result = verifyRecovery(f);
  expect(result).toMatchObject({
    ok: true,
    format: 'luufi-recovery',
    version: 1,
    environment: 'local',
    tableCount: 26,
    rowCount: 4,
    migrationCount: 10,
    verifiedMediaFiles: 0,
  });
  const restored = new DatabaseSync(f.targetPath, { readOnly: true });
  expect(restored.prepare('SELECT * FROM project_ideas').get()).toEqual(
    f.raw.project_ideas[0],
  );
  expect(
    restored.prepare('SELECT * FROM idea_mutation_requests').get(),
  ).toEqual(f.raw.idea_mutation_requests[0]);
  expect(
    restored.prepare('SELECT * FROM luufi_mcp_probe_records').get(),
  ).toEqual(f.raw.luufi_mcp_probe_records[0]);
  for (const table of excludedLegacyTables)
    expect(
      restored.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get(),
    ).toEqual({ n: 0 });
  restored.close();
  expect(JSON.stringify(f.snapshot)).not.toContain('SECRET_NOT_RESTORED');
});
it('prüft fertige private R2-Dateien mit vollständigem SHA und erhält unvollständige Slots', () => {
  const f = fixture(true),
    result = verifyRecovery(f);
  expect(result.verifiedMediaFiles).toBe(1);
  const restored = new DatabaseSync(f.targetPath, { readOnly: true });
  expect(
    restored
      .prepare(
        "SELECT status,object_key FROM feedback_attachments WHERE id='pending'",
      )
      .get(),
  ).toEqual({ status: 'pending', object_key: null });
  expect(
    restored
      .prepare("SELECT sha256 FROM feedback_attachments WHERE id='a'")
      .get(),
  ).toEqual({ sha256: hash(png) });
  restored.close();
});
it.each(['text', 'count', 'migration'] as const)(
  'verweigert %s-Mismatch vor Erzeugen des Ziels',
  (kind) => {
    const f = fixture();
    if (kind === 'text')
      f.snapshot.tables.project_ideas.rows[0].detail = 'Verlorener Text';
    if (kind === 'count') f.snapshot.tables.project_ideas.rowCount = 2;
    if (kind === 'migration') f.snapshot.migrations[0].sha256 = '0'.repeat(64);
    f.save();
    expect(() => verifyRecovery(f)).toThrow();
    expect(existsSync(f.targetPath)).toBe(false);
  },
);
it('überschreibt niemals eine bestehende Zieldatei', () => {
  const f = fixture();
  writeFileSync(f.targetPath, 'Nicht überschreiben');
  expect(() => verifyRecovery(f)).toThrow(/neue/);
  expect(readFileSync(f.targetPath, 'utf8')).toBe('Nicht überschreiben');
});
it.each(['-journal', '-wal', '-shm'])(
  'lässt vorhandenen SQLite-Sidecar %s unverändert und verweigert das Ziel',
  (suffix) => {
    const f = fixture(),
      sidecar = f.targetPath + suffix,
      sentinel = Buffer.from('FREMDE BESTEHENDE DATEI\n');
    writeFileSync(sidecar, sentinel);
    expect(() => verifyRecovery(f)).toThrow();
    expect(readFileSync(sidecar)).toEqual(sentinel);
    expect(existsSync(f.targetPath)).toBe(false);
  },
);
it.each(['', '-journal', '-wal', '-shm'])(
  'bewahrt während des Restores neu eintreffendes Ziel/Sidecar %s',
  (suffix) => {
    const f = fixture(),
      occupied = f.targetPath + suffix,
      sentinel = Buffer.from('PARALLEL ERZEUGT\n'),
      close = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'close')!
        .value as (this: DatabaseSync) => void;
    vi.spyOn(DatabaseSync.prototype, 'close').mockImplementationOnce(
      function (this: DatabaseSync) {
        close.call(this);
        writeFileSync(occupied, sentinel);
      },
    );
    expect(() => verifyRecovery(f)).toThrow();
    expect(readFileSync(occupied)).toEqual(sentinel);
    if (suffix) expect(existsSync(f.targetPath)).toBe(false);
  },
);
it.each([
  'missing-column',
  'extra-column',
  'typed-value',
  'foreign-key',
] as const)(
  'erkennt %s und entfernt ausschließlich das neue fehlgeschlagene Ziel',
  (kind) => {
    const f = fixture(true),
      raw = structuredClone(f.raw);
    if (kind === 'missing-column') delete raw.project_ideas[0].detail;
    if (kind === 'extra-column') raw.project_ideas[0].unknown = 'not-schema';
    if (kind === 'typed-value') raw.project_ideas[0].created_at = '123456789';
    if (kind === 'foreign-key')
      raw.feedback_threads[0].project_id = 'missing-project';
    const changed = makeRecoverySnapshot({
      environment: 'local',
      tables: raw,
      attachments: f.snapshot.attachments,
    });
    writeFileSync(f.snapshotPath, JSON.stringify(changed));
    expect(() => verifyRecovery(f)).toThrow();
    expect(existsSync(f.targetPath)).toBe(false);
  },
);
it('weist unbekannte Tabellen, Legacy-Credentials, unvollständige Metadaten und unsupported Rowtypes ab', () => {
  const f = fixture();
  for (const raw of [
    { ...f.raw, oauth_sessions: [] },
    Object.fromEntries(
      Object.entries(f.raw).filter(([name]) => name !== 'planning_projects'),
    ),
    { ...f.raw, project_ideas: [{ ...f.raw.project_ideas[0], detail: true }] },
    {
      ...f.raw,
      project_ideas: [{ ...f.raw.project_ideas[0], detail: { blob: 'x' } }],
    },
  ])
    expect(() =>
      makeRecoverySnapshot({ environment: 'local', tables: raw }),
    ).toThrow();
  expect(() =>
    makeRecoverySnapshot({ environment: 'invalid', tables: f.raw }),
  ).toThrow();
});
it.each(['missing', 'changed', 'traversal', 'wrong-reference'] as const)(
  'verweigert %s-Medienbelege ohne neue SQLite-Datei',
  (kind) => {
    const f = fixture(true);
    if (kind === 'missing') f.snapshot.attachments = [];
    if (kind === 'changed')
      writeFileSync(
        path.join(f.dir, 'media', 'a.png'),
        new Uint8Array(png.length),
      );
    if (kind === 'traversal')
      f.snapshot.attachments[0].relativePath = '../a.png';
    if (kind === 'wrong-reference')
      f.snapshot.attachments[0].objectKey = 'feedback-media/fremd';
    f.save();
    expect(() => verifyRecovery(f)).toThrow();
    expect(existsSync(f.targetPath)).toBe(false);
  },
);
it('CLI gibt ausschließlich zusammengefasste Nachweise ohne private Inhalte aus', () => {
  const f = fixture(),
    output = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./verify-recovery.mjs', import.meta.url)),
        f.snapshotPath,
        f.targetPath,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  expect(JSON.parse(output)).toMatchObject({ ok: true, rowCount: 4 });
  expect(output).not.toContain('Originaltext');
  expect(output).not.toContain('private-test');
  expect(output).not.toContain('SECRET_NOT_RESTORED');
});
