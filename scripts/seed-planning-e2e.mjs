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
const evidenceSpec = {...spec,title:'Implementierung nachvollziehen',goal:'Freigabe und geprüfte Integration lesen'};
const evidencePayload = {
 outcome:'success',executionId:'execution-e2e',generation:1,commitSha:'b'.repeat(40),
 summary:'Synthetischer normaler PR-Merge mit erhaltenem Auftragscommit',
 criteria:[{id:'C-1',result:'pass',reference:'Synthetischer automatisierter Nachweis'}],
 documentationReference:'docs/features/order-evidence.md',
 observation:{
 repository:'example/demo',branch:'develop',remoteRef:'refs/heads/develop',headSha:'c'.repeat(40),commitSha:'b'.repeat(40),
 observedAt:'2026-01-03T12:00:00.000Z',source:'codex-local-git',commitSubject:'feat(DEMO-3): Implementierung nachvollziehen',
 parentShas:['a'.repeat(40)],ancestorOfHead:true,pushed:true,
 pr:{url:'https://github.com/example/demo/pull/1',baseBranch:'develop',headSha:'b'.repeat(40),merged:true,mergeSha:'c'.repeat(40),normalMerge:true},
 ci:[{url:'https://github.com/example/demo/actions/runs/1',name:'verify',headSha:'b'.repeat(40),conclusion:'success'}],
 },
 validationId:'validation-e2e',unavailableBuildReason:'Synthetischer Stand ohne Bereitstellung',supersedesId:null,
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
INSERT OR IGNORE INTO planning_orders(id,project_id,number,type,status,spec_version,revision,position,lifecycle_revision,current_implementation_id,integration_id) VALUES ('order-evidence-e2e','planning-e2e',3,'feature','done',1,5,1,5,'implementation-e2e','integration-e2e');
INSERT OR IGNORE INTO planning_order_versions(order_id,version,spec_json,created_at) VALUES ('order-evidence-e2e',1,${quoted(JSON.stringify(evidenceSpec))},'2026-01-03T10:00:00.000Z');
INSERT OR IGNORE INTO order_approvals(id,project_id,mode,confirmation_reference,created_at) VALUES ('approval-e2e','planning-e2e','selection','Synthetische Freigabe DEMO-3 v1','2026-01-03T10:00:00.000Z');
INSERT OR IGNORE INTO order_approval_items(approval_id,order_id,spec_version,title,dependency_ids_json,repository,integration_branch) VALUES ('approval-e2e','order-evidence-e2e',1,'Implementierung nachvollziehen','[]','example/demo','develop');
INSERT OR IGNORE INTO order_executions(id,project_id,order_id,spec_version,approval_id,worker,branch,generation,phase,created_at,updated_at) VALUES ('execution-e2e','planning-e2e','order-evidence-e2e',1,'approval-e2e','Synthetischer Codex','feature/demo',1,'closed','2026-01-03T10:01:00.000Z','2026-01-03T12:00:00.000Z');
INSERT OR IGNORE INTO order_progress(id,order_id,execution_id,generation,kind,text,next_action,created_at) VALUES ('progress-e2e','order-evidence-e2e','execution-e2e',1,'test','Prüfungen abgeschlossen','Integration prüfen','2026-01-03T11:00:00.000Z');
INSERT OR IGNORE INTO order_lifecycle_events(id,order_id,spec_version,actor,previous_status,next_status,reason,reference,details_json,created_at) VALUES ('event-e2e','order-evidence-e2e',1,'synthetic-owner','implemented','done','Normaler PR-Merge nach develop','https://github.com/example/demo/pull/1','{}','2026-01-03T12:00:00.000Z');
INSERT OR IGNORE INTO order_evidence(id,order_id,spec_version,kind,outcome,execution_id,generation,payload_json,created_at) VALUES
('validation-e2e','order-evidence-e2e',1,'validation','success','execution-e2e',1,${quoted(JSON.stringify({...evidencePayload,validationId:null,summary:'Synthetische Kriterienprüfung'}))},'2026-01-03T11:00:00.000Z'),
('implementation-e2e','order-evidence-e2e',1,'implementation','success','execution-e2e',1,${quoted(JSON.stringify({...evidencePayload,summary:'Gepushter geprüfter Auftragscommit'}))},'2026-01-03T11:30:00.000Z'),
('integration-e2e','order-evidence-e2e',1,'integration','success','execution-e2e',1,${quoted(JSON.stringify(evidencePayload))},'2026-01-03T12:00:00.000Z');
UPDATE planning_projects SET next_order_number=MAX(next_order_number,4) WHERE id='planning-e2e';
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
