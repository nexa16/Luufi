import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  openSync,
  closeSync,
  unlinkSync,
  lstatSync,
  mkdtempSync,
  rmdirSync,
  linkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const recoveryTables = Object.freeze([
  'project_ideas',
  'idea_mutation_requests',
  'luufi_mcp_probe_records',
  'luufi_mcp_probe_writes',
  'planning_projects',
  'planning_milestones',
  'planning_orders',
  'planning_order_versions',
  'planning_order_relations',
  'planning_requests',
  'feedback_threads',
  'feedback_entries',
  'feedback_attachments',
  'feedback_refinements',
  'feedback_order_sources',
  'order_approvals',
  'order_approval_items',
  'order_executions',
  'order_progress',
  'order_lifecycle_events',
  'order_evidence',
  'project_versions',
  'version_orders',
  'version_builds',
  'version_releases',
  'bootstrap_provenance',
]);
export const excludedLegacyTables = Object.freeze([
  'mutation_operations',
  'mutation_steps',
  'project_snapshots',
  'project_change_events',
  'oauth_sessions',
  'oauth_states',
]);
const defaultMigrations = fileURLToPath(new URL('../drizzle', import.meta.url));
class RecoveryError extends Error {}
/** @returns {never} */
function fail(message) {
  throw new RecoveryError(message);
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function object(value, keys, exact = true) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    (exact && keys.some((key) => !Object.hasOwn(value, key)))
  )
    fail('Das Snapshotformat enthält fehlende oder nicht erlaubte Felder.');
}
const canonical = (value) =>
  JSON.stringify(
    Array.isArray(value)
      ? value.map((item) => JSON.parse(canonical(item)))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, JSON.parse(canonical(value[key]))]),
          )
        : value,
  );
function tableValue(rows) {
  if (!Array.isArray(rows))
    fail('Eine erlaubte Tabelle benötigt ein vollständiges Zeilenarray.');
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      !Object.keys(row).length
    )
      fail('Eine Snapshotzeile ist ungültig.');
    if (
      Object.values(row).some(
        (value) =>
          value !== null &&
          typeof value !== 'string' &&
          !(typeof value === 'number' && Number.isSafeInteger(value)),
      )
    )
      fail(
        'Nicht unterstützter Zeilentyp; nur Strings, sichere Ganzzahlen und null sind erlaubt.',
      );
  }
  const normalized = rows.map((row) => String(canonical(row))).sort();
  return { rows, rowCount: rows.length, sha256: digest(normalized.join('\n')) };
}
function migrationFiles(directory) {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (
    !names.length ||
    names.some((name) => !/^\d{4}_[A-Za-z0-9_]+\.sql$/.test(name))
  )
    fail('Die Migrationsdateiliste ist ungültig.');
  return names.map((name) => ({
    name,
    sha256: digest(readFileSync(path.join(directory, name))),
  }));
}
function metadata(snapshot) {
  object(snapshot, [
    'format',
    'version',
    'environment',
    'capturedAt',
    'migrations',
    'tables',
    'attachments',
  ]);
  if (
    snapshot.format !== 'luufi-recovery' ||
    snapshot.version !== 1 ||
    !['preview', 'production', 'local'].includes(snapshot.environment) ||
    typeof snapshot.capturedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(snapshot.capturedAt) ||
    !Number.isFinite(Date.parse(snapshot.capturedAt))
  )
    fail('Die Snapshotmetadaten sind nicht unterstützt.');
  object(snapshot.tables, [...recoveryTables]);
  for (const table of recoveryTables) {
    const value = snapshot.tables[table];
    object(value, ['rows', 'rowCount', 'sha256']);
    const actual = tableValue(value.rows);
    if (
      value.rowCount !== actual.rowCount ||
      !hash(value.sha256) ||
      value.sha256 !== actual.sha256
    )
      fail(`Vollständigkeits- oder Inhaltshash stimmt nicht: ${table}.`);
  }
  if (
    !Array.isArray(snapshot.migrations) ||
    !Array.isArray(snapshot.attachments)
  )
    fail('Migrations-/Medienmanifest fehlt.');
  for (const migration of snapshot.migrations) {
    object(migration, ['name', 'sha256']);
    if (typeof migration.name !== 'string' || !hash(migration.sha256))
      fail('Ein Migrationsnachweis ist ungültig.');
  }
}
/** Produces metadata/digests from complete private raw exports; never logs rows.
 * @param {{environment:string,capturedAt?:string,tables:Record<string,Record<string,unknown>[]>,attachments?:{attachmentId:string,objectKey:string,relativePath:string,size:number,sha256:string}[],migrationDirectory?:string}} options */
export function makeRecoverySnapshot({
  environment,
  capturedAt = new Date().toISOString(),
  tables,
  attachments = [],
  migrationDirectory = defaultMigrations,
}) {
  object(tables, [...recoveryTables]);
  const snapshot = {
    format: 'luufi-recovery',
    version: 1,
    environment,
    capturedAt,
    migrations: migrationFiles(migrationDirectory),
    tables: Object.fromEntries(
      recoveryTables.map((table) => [table, tableValue(tables[table])]),
    ),
    attachments,
  };
  metadata(snapshot);
  return snapshot;
}
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
function verifyReferences(db) {
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    fail('Die wiederhergestellten Fremdschlüssel sind unvollständig.');
  const checks = [
    'SELECT 1 FROM planning_orders o WHERE NOT EXISTS(SELECT 1 FROM planning_order_versions v WHERE v.order_id=o.id AND v.version=o.spec_version)',
    "SELECT 1 FROM planning_orders o WHERE (o.current_implementation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_evidence e WHERE e.id=o.current_implementation_id AND e.order_id=o.id AND e.kind='implementation')) OR (o.integration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_evidence e WHERE e.id=o.integration_id AND e.order_id=o.id AND e.kind='integration'))",
    'SELECT 1 FROM planning_orders o JOIN planning_milestones m ON m.id=o.milestone_id WHERE o.project_id<>m.project_id',
    'SELECT 1 FROM planning_order_relations r JOIN planning_orders s ON s.id=r.source_id JOIN planning_orders t ON t.id=r.target_id WHERE s.project_id<>t.project_id',
    'SELECT 1 FROM feedback_attachments a JOIN feedback_entries e ON e.id=a.entry_id JOIN feedback_threads f ON f.id=a.feedback_id WHERE e.feedback_id<>a.feedback_id OR f.project_id<>a.project_id',
    'SELECT 1 FROM feedback_order_sources s JOIN feedback_refinements r ON r.id=s.refinement_id JOIN feedback_threads f ON f.id=s.feedback_id JOIN planning_orders o ON o.id=s.order_id WHERE r.feedback_id<>s.feedback_id OR o.project_id<>f.project_id',
    'SELECT 1 FROM order_approval_items i JOIN order_approvals a ON a.id=i.approval_id JOIN planning_orders o ON o.id=i.order_id WHERE a.project_id<>o.project_id',
    'SELECT 1 FROM order_approval_items i WHERE NOT EXISTS(SELECT 1 FROM planning_order_versions v WHERE v.order_id=i.order_id AND v.version=i.spec_version)',
    'SELECT 1 FROM order_executions e JOIN order_approvals a ON a.id=e.approval_id JOIN planning_orders o ON o.id=e.order_id WHERE e.project_id<>o.project_id OR a.project_id<>o.project_id OR NOT EXISTS(SELECT 1 FROM planning_order_versions v WHERE v.order_id=e.order_id AND v.version=e.spec_version)',
    'SELECT 1 FROM order_progress r JOIN order_executions e ON e.id=r.execution_id WHERE r.order_id<>e.order_id OR r.generation>e.generation',
    'SELECT 1 FROM order_evidence r JOIN order_executions e ON e.id=r.execution_id WHERE r.order_id<>e.order_id OR r.spec_version<>e.spec_version OR r.generation>e.generation',
    "SELECT 1 FROM order_evidence r WHERE json_type(r.payload_json,'$.validationId') IS NOT NULL AND json_type(r.payload_json,'$.validationId')<>'null' AND (json_type(r.payload_json,'$.validationId')<>'text' OR NOT EXISTS(SELECT 1 FROM order_evidence v WHERE v.id=json_extract(r.payload_json,'$.validationId') AND v.kind='validation' AND v.order_id=r.order_id AND v.spec_version=r.spec_version AND v.execution_id=r.execution_id AND v.generation=r.generation))",
    'SELECT 1 FROM order_lifecycle_events e WHERE NOT EXISTS(SELECT 1 FROM planning_order_versions v WHERE v.order_id=e.order_id AND v.version=e.spec_version)',
    'SELECT 1 FROM version_orders r JOIN project_versions v ON v.id=r.version_id JOIN planning_orders o ON o.id=r.order_id WHERE v.project_id<>o.project_id',
    'SELECT 1 FROM version_orders r WHERE NOT EXISTS(SELECT 1 FROM planning_order_versions v WHERE v.order_id=r.order_id AND v.version=r.spec_version)',
    "SELECT 1 FROM version_orders r WHERE (r.implementation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_evidence e WHERE e.id=r.implementation_id AND e.order_id=r.order_id AND e.spec_version=r.spec_version AND e.kind='implementation')) OR (r.integration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM order_evidence e WHERE e.id=r.integration_id AND e.order_id=r.order_id AND e.spec_version=r.spec_version AND e.kind='integration'))",
    'SELECT 1 FROM version_releases r JOIN project_versions v ON v.id=r.version_id WHERE r.project_id<>v.project_id',
    "SELECT 1 FROM version_releases r WHERE json_type(r.payload_json,'$.buildId') IS NOT 'text' OR NOT EXISTS(SELECT 1 FROM version_builds b WHERE b.id=json_extract(r.payload_json,'$.buildId') AND b.version_id=r.version_id)",
    'SELECT 1 FROM project_versions v WHERE v.release_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM version_releases r WHERE r.id=v.release_id AND r.version_id=v.id AND r.project_id=v.project_id)',
    'SELECT 1 FROM bootstrap_provenance b JOIN planning_orders o ON o.id=b.order_id WHERE b.number<>o.number',
  ];
  if (checks.some((query) => db.prepare(`${query} LIMIT 1`).get()))
    fail(
      'Die wiederhergestellten Projekt-/Auftragsreferenzen sind inkonsistent.',
    );
}
function verifyMedia(snapshot, snapshotPath) {
  const ready = snapshot.tables.feedback_attachments.rows.filter(
      (row) => row.status === 'ready',
    ),
    files = new Map(),
    root = realpathSync(path.dirname(snapshotPath));
  for (const file of snapshot.attachments) {
    object(file, [
      'attachmentId',
      'objectKey',
      'relativePath',
      'size',
      'sha256',
    ]);
    if (
      typeof file.attachmentId !== 'string' ||
      !file.attachmentId ||
      files.has(file.attachmentId) ||
      typeof file.objectKey !== 'string' ||
      !file.objectKey ||
      typeof file.relativePath !== 'string' ||
      !file.relativePath ||
      path.isAbsolute(file.relativePath) ||
      /[\p{Cc}:\\]/u.test(file.relativePath) ||
      file.relativePath
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > 15_000_000 ||
      !hash(file.sha256)
    )
      fail('Das private Medienmanifest ist ungültig.');
    const row = ready.find((row) => row.id === file.attachmentId);
    if (
      !row ||
      row.object_key !== file.objectKey ||
      row.actual_size !== file.size ||
      row.sha256 !== file.sha256
    )
      fail('Medienmanifest und fertige D1-Referenz stimmen nicht überein.');
    const resolved = realpathSync(path.resolve(root, file.relativePath)),
      relative = path.relative(root, resolved);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      fail('Ein Medienpfad verlässt den privaten Snapshotordner.');
    const info = statSync(resolved);
    if (
      !info.isFile() ||
      info.size !== file.size ||
      digest(readFileSync(resolved)) !== file.sha256
    )
      fail(
        'Eine referenzierte Mediendatei fehlt oder ihr Inhaltshash stimmt nicht.',
      );
    files.set(file.attachmentId, file);
  }
  if (files.size !== ready.length)
    fail('Der Snapshot ist unvollständig: fertige private Medienbytes fehlen.');
  return files.size;
}
function requireVacantTarget(target) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      // lstat also detects dangling symlinks, which existsSync would miss.
      lstatSync(target + suffix);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      fail(
        'Der neue SQLite-Zielpfad und seine Sidecars müssen frei und überprüfbar sein.',
      );
    }
    fail('Der neue SQLite-Zielpfad und seine Sidecars müssen frei sein.');
  }
}
/** Restores in an exclusive staging directory. SQLite never opens the final
 * pathname, so even a concurrently created final sidecar cannot be touched. */
export function verifyRecovery({
  snapshotPath,
  targetPath,
  migrationDirectory = defaultMigrations,
}) {
  let db, stagingDirectory, stagingFile, target;
  try {
    if (
      typeof snapshotPath !== 'string' ||
      !snapshotPath ||
      typeof targetPath !== 'string' ||
      !targetPath
    )
      fail('Snapshot- und neuer Zielpfad sind erforderlich.');
    const source = path.resolve(snapshotPath);
    target = path.resolve(targetPath);
    const bytes = readFileSync(source),
      snapshot = JSON.parse(bytes.toString('utf8'));
    metadata(snapshot);
    const migrations = migrationFiles(migrationDirectory);
    if (canonical(snapshot.migrations) !== canonical(migrations))
      fail(
        'Migrationsnamen oder unveränderte Dateihashes stimmen nicht überein.',
      );
    const files = verifyMedia(snapshot, source);
    requireVacantTarget(target);
    stagingDirectory = mkdtempSync(
      path.join(path.dirname(target), '.luufi-recovery-'),
    );
    stagingFile = path.join(stagingDirectory, 'restore.sqlite');
    const descriptor = openSync(stagingFile, 'wx', 0o600);
    closeSync(descriptor);
    db = new DatabaseSync(stagingFile);
    db.exec(
      'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON;',
    );
    for (const migration of migrations)
      db.exec(
        readFileSync(path.join(migrationDirectory, migration.name), 'utf8'),
      );
    for (const table of recoveryTables) {
      const columns = db
        .prepare(`PRAGMA table_info(${quote(table)})`)
        .all()
        .map((column) => column.name);
      if (!columns.length) fail(`Erwartetes Rebuildschema fehlt: ${table}.`);
      const insert = db.prepare(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      );
      for (const row of snapshot.tables[table].rows) {
        object(row, columns);
        insert.run(...columns.map((column) => row[column]));
      }
    }
    verifyReferences(db);
    const counts = {};
    for (const table of recoveryTables) {
      const actual = tableValue(
          db.prepare(`SELECT * FROM ${quote(table)}`).all(),
        ),
        expected = snapshot.tables[table];
      if (
        actual.rowCount !== expected.rowCount ||
        actual.sha256 !== expected.sha256
      )
        fail(`Vollständiger Werte-/Typvergleich fehlgeschlagen: ${table}.`);
      counts[table] = actual.rowCount;
    }
    for (const table of excludedLegacyTables)
      if (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get().n !== 0)
        fail(
          'Ausgeschlossene Legacy-Daten wurden unerwartet wiederhergestellt.',
        );
    db.exec('COMMIT');
    db.close();
    db = undefined;
    requireVacantTarget(target);
    try {
      // Staging is on the same filesystem. link() atomically creates a complete
      // final file and refuses EEXIST; unlike rename(), it never replaces one.
      linkSync(stagingFile, target);
    } catch {
      fail(
        'Die neue SQLite-Datei konnte nicht kollisionsfrei veröffentlicht werden. Bestehende Dateien bleiben unverändert.',
      );
    }
    return {
      ok: true,
      format: 'luufi-recovery',
      version: 1,
      environment: snapshot.environment,
      snapshotSha256: digest(bytes),
      tableCount: recoveryTables.length,
      rowCount: Object.values(counts).reduce((a, b) => a + b, 0),
      tables: counts,
      verifiedMediaFiles: files,
      migrationCount: migrations.length,
      excludedLegacyTables: [...excludedLegacyTables],
    };
  } catch (error) {
    if (db) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      try {
        db.close();
      } catch {}
    }
    if (error instanceof RecoveryError) throw error;
    fail(
      'Die Wiederherstellung ist fehlgeschlagen: Dateien, vollständige Zeilen und Referenzen prüfen. Private Inhalte wurden nicht ausgegeben.',
    );
  } finally {
    // Only our file inside the exclusively created staging directory is removed.
    // Never remove the requested final path or any final-path sidecar.
    if (stagingFile) {
      try {
        unlinkSync(stagingFile);
      } catch {}
    }
    if (stagingDirectory) {
      // No recursive cleanup: unexpected files are preserved rather than deleted.
      try {
        rmdirSync(stagingDirectory);
      } catch {}
    }
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      fail(
        'Aufruf: node scripts/verify-recovery.mjs SNAPSHOT.json NEUE.sqlite',
      );
    process.stdout.write(
      `${JSON.stringify(verifyRecovery({ snapshotPath: process.argv[2], targetPath: process.argv[3] }), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof RecoveryError ? error.message : 'Die Wiederherstellungsprüfung ist fehlgeschlagen.'}\n`,
    );
    process.exitCode = 1;
  }
}
