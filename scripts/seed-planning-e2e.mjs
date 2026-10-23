// Disposable synthetic data, exclusively in the loopback E2E D1 database.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import local from '../.github/scripts/local-d1-migrations.cjs';

const directory = mkdtempSync(join(tmpdir(), 'luufi-planning-e2e-'));
const quoted = (value) => "'" + value.replaceAll("'", "''") + "'";
const spec = {
  title: 'Projektübersicht lesen',
  goal: 'Planung nachvollziehen',
  origin: 'Synthetischer Browsertest',
  problem: 'Überblick behalten',
  scope: 'Nur Lesen',
  exclusions: 'Keine Bearbeitung',
  flows: 'Projekt öffnen und Auftrag lesen',
  criteria: [{ id: 'C-1', text: 'Projekt und Auftrag sind sichtbar' }],
  testStrategy: 'Browser auf Desktop und Handy',
  prerequisites: '',
  documentation: 'docs/features/project-views.md',
  context: { repositoryCommit: 'a'.repeat(40), documentationPolicy: '1.0.0' },
  sources: [],
};
const content = `
INSERT OR IGNORE INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints,next_order_number) VALUES ('planning-e2e','DEMO','Beispielprojekt','example/demo','develop','main','["README.md"]','Nur synthetische lokale Testdaten',3);
INSERT OR IGNORE INTO planning_milestones(id,project_id,title,description,position) VALUES ('milestone-e2e','planning-e2e','Erster Meilenstein','Lesbare Projektplanung',0);
INSERT OR IGNORE INTO planning_orders(id,project_id,number,type,status,spec_version,revision,milestone_id,position) VALUES ('order-e2e','planning-e2e',1,'feature','draft',2,1,'milestone-e2e',0),('order-unplanned-e2e','planning-e2e',2,'defect','draft',1,0,NULL,0);
INSERT OR IGNORE INTO planning_order_versions(order_id,version,spec_json,created_at) VALUES
('order-e2e',1,${quoted(JSON.stringify({ ...spec, goal: 'Früherer Entwurf' }))},'2026-01-01T00:00:00.000Z'),
('order-e2e',2,${quoted(JSON.stringify(spec))},'2026-01-02T00:00:00.000Z'),
('order-unplanned-e2e',1,${quoted(JSON.stringify({ ...spec, title: 'Kleinen Fehler beheben' }))},'2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO planning_order_relations(source_id,target_id,type) VALUES ('order-e2e','order-unplanned-e2e','related');
`;
try {
  const file = join(directory, 'seed.sql');
  writeFileSync(file, content);
  const result = spawnSync(
    process.execPath,
    [
      local.resolveWranglerBinary(),
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      local.CONFIG_FILE,
      '--persist-to',
      local.DEFAULT_PERSISTENCE_DIRECTORY,
      '--file',
      file,
    ],
    {
      cwd: local.REPOSITORY_ROOT,
      env: { ...process.env, CI: 'true' },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
