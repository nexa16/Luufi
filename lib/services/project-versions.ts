import { getD1 } from '@/lib/data/d1';
import type {
  BuildInput,
  BuildRecord,
  LatestAvailableVersion,
  ProjectVersion,
  ReleaseInput,
  ReleaseObservation,
  ReleaseRecord,
  VersionInput,
  VersionOrder,
} from '@/lib/domain/releases';
import type { Page, PageOptions } from '@/lib/domain/planning';
import {
  buildJson,
  releaseJson,
  versionJson,
  versionOrderJson,
} from './releases-sql';
import {
  authorizePlanning,
  expectedRevision,
  planningAttempt,
  planningId,
  planningMutation,
  planningPage,
  planningStorage,
  planningText,
  PlanningError,
  sql,
  type Sql,
} from './planning-store';
const invalid = (message = 'Der Versionsnachweis ist ungültig.'): never => {
  throw new PlanningError('validation', message);
};
const conflict = (
  message = 'Die Version oder ihre Voraussetzung wurde inzwischen geändert. Bitte neu laden.',
): never => {
  throw new PlanningError('conflict', message);
};
function object(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
}
const text = (value: unknown, name: string, max = 4000, required = true) =>
  planningText(value, name, max, required);
function sha(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value))
    return invalid('Ein vollständiger 40-stelliger Git-SHA ist erforderlich.');
  return value.toLowerCase();
}
function ref(value: unknown) {
  const s = text(value, 'Branch oder Tag', 200);
  if (
    Array.from(s).some(
      (c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127,
    ) ||
    s.startsWith('-') ||
    s.includes('..') ||
    s.includes('@{') ||
    /[~^:?*[\\]/.test(s) ||
    s.endsWith('/') ||
    s.endsWith('.lock')
  )
    invalid('Der Branch oder Tag ist ungültig.');
  return s;
}
function link(value: unknown) {
  const s = text(value, 'Link', 1000);
  try {
    const u = new URL(s);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
      invalid();
  } catch {
    invalid('Ein sicherer HTTP(S)-Link ohne Zugangsdaten ist erforderlich.');
  }
  return s;
}
function date(value: unknown) {
  const s = text(value, 'Beobachtungszeit', 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s)))
    return invalid('Die Beobachtungszeit ist ungültig.');
  return new Date(s).toISOString();
}
function scope(actor: string, p: string, id?: string) {
  authorizePlanning(actor);
  planningId(p);
  if (id !== undefined) planningId(id);
}
type ProjectState = {
  id: string;
  project_key: string;
  repository: string;
  integration_branch: string;
  production_branch: string;
  planning_revision: number;
  versions_revision: number;
  revision: number;
};
async function project(p: string) {
  const row = await getD1()
    .prepare('SELECT * FROM planning_projects WHERE id=?')
    .bind(p)
    .first<ProjectState>();
  if (!row)
    throw new PlanningError('not_found', 'Das Projekt wurde nicht gefunden.');
  return row;
}
async function version(p: string, id: string) {
  const row = await getD1()
    .prepare(
      `SELECT ${versionJson()} AS data FROM project_versions v WHERE v.project_id=? AND v.id=?`,
    )
    .bind(p, id)
    .first<{ data: string }>();
  if (!row)
    throw new PlanningError('not_found', 'Die Version wurde nicht gefunden.');
  return JSON.parse(row.data) as ProjectVersion;
}
const versionResult = (id: string) =>
  sql(`SELECT ${versionJson()} FROM project_versions v WHERE v.id=?`, id);
function versionInput(input: VersionInput) {
  object(input, [
    'label',
    'channel',
    'title',
    'changelog',
    'repositoryCommit',
    'sourceBranch',
    'scope',
  ]);
  if (!['develop', 'production'].includes(input.channel)) invalid();
  object(input.scope, ['mode', 'orderIds', 'milestoneId']);
  let selected: VersionInput['scope'];
  if (input.scope.mode === 'selection') {
    if (
      input.scope.milestoneId !== undefined ||
      !Array.isArray(input.scope.orderIds) ||
      !input.scope.orderIds.length ||
      input.scope.orderIds.length > 50 ||
      new Set(input.scope.orderIds).size !== input.scope.orderIds.length
    )
      invalid(
        'Eine eindeutige Auswahl von 1 bis 50 Aufträgen ist erforderlich.',
      );
    input.scope.orderIds!.forEach(planningId);
    selected = {
      mode: 'selection',
      orderIds: [...input.scope.orderIds!].sort(),
    };
  } else if (input.scope.mode === 'milestone') {
    if (input.scope.orderIds !== undefined) invalid();
    planningId(input.scope.milestoneId);
    selected = { mode: 'milestone', milestoneId: input.scope.milestoneId };
  } else return invalid();
  return {
    label: text(input.label, 'Label', 80),
    channel: input.channel,
    title: text(input.title, 'Titel', 280),
    changelog: text(input.changelog, 'Änderungsnotizen', 20000),
    repositoryCommit: sha(input.repositoryCommit),
    sourceBranch: ref(input.sourceBranch),
    scope: selected,
  };
}
// Current W5 evidence and explicit immutable bootstrap proofs stay separate.
const provenance = `SELECT o.id,o.project_id,o.number,o.spec_version,o.status,json_extract(v.spec_json,'$.title') AS title,
CASE WHEN e.id IS NOT NULL AND i.id IS NOT NULL AND json_extract(e.payload_json,'$.commitSha')=json_extract(i.payload_json,'$.commitSha') THEN e.id ELSE NULL END AS implementation_id,
CASE WHEN e.id IS NOT NULL AND i.id IS NOT NULL AND json_extract(e.payload_json,'$.commitSha')=json_extract(i.payload_json,'$.commitSha') THEN i.id ELSE NULL END AS integration_id,
CASE WHEN e.id IS NOT NULL AND i.id IS NOT NULL AND json_extract(e.payload_json,'$.commitSha')=json_extract(i.payload_json,'$.commitSha') THEN json_extract(e.payload_json,'$.commitSha') ELSE b.implementation_commit END AS implementation_commit,
CASE WHEN e.id IS NOT NULL AND i.id IS NOT NULL AND json_extract(e.payload_json,'$.commitSha')=json_extract(i.payload_json,'$.commitSha') THEN json_extract(i.payload_json,'$.observation.pr.url') ELSE b.pr_url END AS integration_reference,
CASE WHEN e.id IS NOT NULL AND i.id IS NOT NULL AND json_extract(e.payload_json,'$.commitSha')=json_extract(i.payload_json,'$.commitSha') THEN 'execution' WHEN b.kind='public-git' AND length(b.implementation_commit)=40 AND length(b.integration_commit)=40 AND b.pr_url IS NOT NULL AND b.ci_url IS NOT NULL THEN 'bootstrap' ELSE NULL END AS provenance_kind
FROM planning_orders o JOIN planning_order_versions v ON v.order_id=o.id AND v.version=o.spec_version
LEFT JOIN order_evidence e ON e.id=o.current_implementation_id AND e.order_id=o.id AND e.spec_version=o.spec_version AND e.kind='implementation' AND e.outcome='success'
LEFT JOIN order_evidence i ON i.id=o.integration_id AND i.order_id=o.id AND i.spec_version=o.spec_version AND i.kind='integration' AND i.outcome='success'
LEFT JOIN bootstrap_provenance b ON b.order_id=o.id`;
export async function createProjectVersion(
  actor: string,
  p: string,
  input: VersionInput,
  planningRevision: number,
  key: string,
): Promise<ProjectVersion> {
  scope(actor, p);
  expectedRevision(planningRevision);
  const value = versionInput(input),
    payload = {
      projectId: p,
      expectedPlanningRevision: planningRevision,
      ...value,
    };
  return planningAttempt(actor, 'versions.create', payload, key, async () => {
    const current = await project(p);
    if (current.planning_revision !== planningRevision) conflict();
    let filter: Sql;
    if (value.scope.mode === 'selection')
      filter = sql(
        'o.project_id=? AND o.id IN (SELECT value FROM json_each(?))',
        p,
        JSON.stringify(value.scope.orderIds),
      );
    else {
      const milestone = await getD1()
        .prepare(
          'SELECT 1 FROM planning_milestones WHERE project_id=? AND id=?',
        )
        .bind(p, value.scope.milestoneId)
        .first();
      if (!milestone)
        throw new PlanningError(
          'not_found',
          'Der Milestone wurde nicht gefunden.',
        );
      filter = sql(
        'o.project_id=? AND o.milestone_id=?',
        p,
        value.scope.milestoneId!,
      );
    }
    const selected = `${provenance} WHERE ${filter.sql}`;
    const summary = await getD1()
      .prepare(
        `SELECT count(*) AS total,sum(CASE WHEN status='done' AND provenance_kind IS NOT NULL AND implementation_commit IS NOT NULL AND integration_reference IS NOT NULL THEN 1 ELSE 0 END) AS valid FROM (${selected})`,
      )
      .bind(...filter.params!)
      .first<{ total: number; valid: number }>();
    if (
      !summary?.total ||
      (value.scope.mode === 'selection' &&
        summary.total !== value.scope.orderIds!.length)
    )
      throw new PlanningError(
        'not_found',
        'Mindestens ein ausgewählter Auftrag wurde nicht gefunden.',
      );
    if (summary.valid !== summary.total)
      conflict(
        'Alle Versionsmitglieder müssen erledigt und durch aktuelle Integration oder öffentliche Bootstrap-Gitprovenienz belegt sein.',
      );
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    return planningMutation<ProjectVersion>({
      actor,
      operation: 'versions.create',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND planning_revision=?) AND NOT EXISTS(SELECT 1 FROM project_versions WHERE project_id=? AND label=? AND channel=?) AND (SELECT count(*) FROM (${selected}) WHERE status='done' AND provenance_kind IS NOT NULL AND implementation_commit IS NOT NULL AND integration_reference IS NOT NULL)=? AND (SELECT count(*) FROM (${selected}))=?`,
        p,
        planningRevision,
        p,
        value.label,
        value.channel,
        ...filter.params!,
        summary.total,
        ...filter.params!,
        summary.total,
      ),
      writes: (gate) => [
        sql(
          `INSERT INTO project_versions(id,project_id,label,channel,title,changelog,repository_commit,source_branch,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
          id,
          p,
          value.label,
          value.channel,
          value.title,
          value.changelog,
          value.repositoryCommit,
          value.sourceBranch,
          now,
          ...gate.params!,
        ),
        sql(
          `INSERT INTO version_orders(id,version_id,order_id,display_id,title,spec_version,implementation_id,integration_id,implementation_commit,integration_reference,provenance_kind) SELECT lower(hex(randomblob(16))),?,id,?||'-'||number,title,spec_version,implementation_id,integration_id,implementation_commit,integration_reference,provenance_kind FROM (${selected}) WHERE ${gate.sql}`,
          id,
          current.project_key,
          ...filter.params!,
          ...gate.params!,
        ),
        sql(
          `UPDATE planning_projects SET versions_revision=versions_revision+1 WHERE id=? AND ${gate.sql}`,
          p,
          ...gate.params!,
        ),
      ],
      result: versionResult(id),
    });
  });
}
export async function getProjectVersion(actor: string, p: string, id: string) {
  scope(actor, p, id);
  return planningStorage(() => version(p, id));
}
async function pages<T>(
  actor: string,
  p: string,
  id: string | null,
  kind: 'versions' | 'orders' | 'builds' | 'releases',
  options: PageOptions = {},
): Promise<Page<T>> {
  scope(actor, p, id ?? undefined);
  return planningStorage(async () => {
    const first = id ? await version(p, id) : await project(p);
    const revision =
      'versions_revision' in first ? first.versions_revision : first.revision;
    const page = planningPage(
      options,
      { kind: `version-${kind}`, p, id },
      revision,
    );
    const query =
      kind === 'versions'
        ? `SELECT ${versionJson()} AS data FROM project_versions v WHERE v.project_id=? ORDER BY v.created_at DESC,v.rowid DESC`
        : kind === 'orders'
          ? `SELECT ${versionOrderJson()} AS data FROM version_orders o WHERE o.version_id=? ORDER BY CAST(substr(o.display_id,instr(o.display_id,'-')+1) AS INTEGER),o.id`
          : kind === 'builds'
            ? `SELECT ${buildJson()} AS data FROM version_builds b WHERE b.version_id=? ORDER BY b.observed_at DESC,b.rowid DESC`
            : `SELECT ${releaseJson()} AS data FROM version_releases r WHERE r.version_id=? ORDER BY r.created_at DESC,r.rowid DESC`;
    const rows = await getD1()
      .prepare(`${query} LIMIT ? OFFSET ?`)
      .bind(id ?? p, page.limit + 1, page.offset)
      .all<{ data: string }>();
    const latest = id ? await version(p, id) : await project(p);
    if (
      ('versions_revision' in latest
        ? latest.versions_revision
        : latest.revision) !== revision
    )
      conflict('Die Versionsliste wurde geändert. Bitte beginne erneut.');
    return {
      items: rows.results
        .slice(0, page.limit)
        .map((row) => JSON.parse(row.data)),
      nextCursor: page.next(rows.results.length > page.limit),
    };
  });
}
export const listProjectVersions = (
  actor: string,
  p: string,
  options: PageOptions = {},
) => pages<ProjectVersion>(actor, p, null, 'versions', options);
export const listVersionOrders = (
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
) => pages<VersionOrder>(actor, p, id, 'orders', options);
export const listVersionBuilds = (
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
) => pages<BuildRecord>(actor, p, id, 'builds', options);
export const listVersionReleases = (
  actor: string,
  p: string,
  id: string,
  options: PageOptions = {},
) => pages<ReleaseRecord>(actor, p, id, 'releases', options);
function buildInput(input: BuildInput) {
  object(input, [
    'kind',
    'outcome',
    'url',
    'reason',
    'environment',
    'projectCommit',
    'sourceKind',
    'sourceBranch',
    'sourceCommit',
    'versionCommitIncluded',
    'mappingReference',
    'observedAt',
    'verificationReference',
  ]);
  if (
    !['site', 'apk'].includes(input.kind) ||
    !['available', 'unavailable', 'failure'].includes(input.outcome) ||
    !['preview', 'production'].includes(input.environment) ||
    !['github', 'sites'].includes(input.sourceKind) ||
    typeof input.versionCommitIncluded !== 'boolean'
  )
    invalid();
  const available = input.outcome === 'available';
  if (!available && input.url !== null)
    invalid(
      'Ein nicht verfügbarer Build darf keinen verfügbaren Link behaupten.',
    );
  return {
    ...input,
    url: available ? link(input.url) : null,
    reason: text(input.reason, 'Buildgrund', 4000, !available),
    projectCommit: sha(input.projectCommit),
    sourceCommit: sha(input.sourceCommit),
    sourceBranch: ref(input.sourceBranch),
    mappingReference: text(
      input.mappingReference,
      'Quellenzuordnung',
      1000,
      false,
    ),
    observedAt: date(input.observedAt),
    verificationReference: text(
      input.verificationReference,
      'Prüfverweis',
      1000,
    ),
  };
}
function revisionWrites(gate: Sql, p: string, id: string) {
  return [
    sql(
      `UPDATE project_versions SET revision=revision+1 WHERE id=? AND ${gate.sql}`,
      id,
      ...gate.params!,
    ),
    sql(
      `UPDATE planning_projects SET versions_revision=versions_revision+1 WHERE id=? AND ${gate.sql}`,
      p,
      ...gate.params!,
    ),
  ];
}
export async function recordVersionBuild(
  actor: string,
  p: string,
  id: string,
  input: BuildInput,
  revision: number,
  key: string,
): Promise<BuildRecord> {
  scope(actor, p, id);
  expectedRevision(revision);
  const value = buildInput(input),
    payload = { projectId: p, id, expectedRevision: revision, ...value };
  return planningAttempt(actor, 'versions.build', payload, key, async () => {
    const current = await version(p, id);
    if (current.revision !== revision) conflict();
    if (
      value.sourceKind === 'github' &&
      value.sourceCommit !== value.projectCommit
    )
      invalid(
        'GitHub-Quelle und öffentlicher Projektcommit müssen übereinstimmen.',
      );
    if (value.sourceKind === 'sites' && !value.mappingReference)
      invalid(
        'Eine Sites-Quelle benötigt die genaue Zuordnung zum öffentlichen Projektcommit.',
      );
    if (
      value.projectCommit !== current.repositoryCommit &&
      (!value.versionCommitIncluded || !value.mappingReference)
    )
      invalid(
        'Ein abweichender öffentlicher Buildstand benötigt den geprüften Versionseinschluss und seine Zuordnung.',
      );
    if (value.outcome === 'available' && !value.versionCommitIncluded)
      invalid('Ein verfügbarer Build muss die Version nachweislich enthalten.');
    const buildId = crypto.randomUUID(),
      now = new Date().toISOString();
    return planningMutation<BuildRecord>({
      actor,
      operation: 'versions.build',
      payload,
      key,
      guard: sql(
        'EXISTS(SELECT 1 FROM project_versions WHERE project_id=? AND id=? AND revision=?)',
        p,
        id,
        revision,
      ),
      writes: (gate) => [
        sql(
          `INSERT INTO version_builds(id,version_id,kind,environment,outcome,payload_json,observed_at,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
          buildId,
          id,
          value.kind,
          value.environment,
          value.outcome,
          JSON.stringify(value),
          value.observedAt,
          now,
          ...gate.params!,
        ),
        ...revisionWrites(gate, p, id),
      ],
      result: sql(
        `SELECT ${buildJson()} FROM version_builds b WHERE b.id=?`,
        buildId,
      ),
    });
  });
}
function releaseObservation(input: ReleaseObservation) {
  object(input, [
    'repository',
    'productionBranch',
    'productionHead',
    'tag',
    'tagCommit',
    'versionCommit',
    'versionCommitIncluded',
    'observedAt',
    'source',
    'ci',
  ]);
  if (
    input.source !== 'codex-local-git' ||
    typeof input.versionCommitIncluded !== 'boolean' ||
    !Array.isArray(input.ci) ||
    !input.ci.length ||
    input.ci.length > 50
  )
    invalid();
  return {
    repository: text(input.repository, 'Repository', 1000),
    productionBranch: ref(input.productionBranch),
    productionHead: sha(input.productionHead),
    tag: ref(input.tag),
    tagCommit: sha(input.tagCommit),
    versionCommit: sha(input.versionCommit),
    versionCommitIncluded: input.versionCommitIncluded,
    observedAt: date(input.observedAt),
    source: 'codex-local-git' as const,
    ci: input.ci.map((item) => {
      object(item, ['url', 'name', 'headSha', 'conclusion']);
      if (
        !['success', 'failure', 'cancelled', 'pending'].includes(
          item.conclusion,
        )
      )
        invalid();
      return {
        url: link(item.url),
        name: text(item.name, 'CI-Name', 200),
        headSha: sha(item.headSha),
        conclusion: item.conclusion,
      };
    }),
  };
}
export async function recordVersionRelease(
  actor: string,
  p: string,
  id: string,
  input: ReleaseInput,
  revision: number,
  key: string,
): Promise<ReleaseRecord> {
  scope(actor, p, id);
  expectedRevision(revision);
  object(input, [
    'confirmationReference',
    'productionBranch',
    'productionCommit',
    'tag',
    'tagCommit',
    'buildId',
    'observation',
    'deploymentReference',
  ]);
  planningId(input.buildId);
  const value = {
      confirmationReference: text(
        input.confirmationReference,
        'Nutzerfreigabe',
        1000,
      ),
      productionBranch: ref(input.productionBranch),
      productionCommit: sha(input.productionCommit),
      tag: ref(input.tag),
      tagCommit: sha(input.tagCommit),
      buildId: input.buildId,
      observation: releaseObservation(input.observation),
      deploymentReference: text(
        input.deploymentReference,
        'Deploymentprüfung',
        1000,
      ),
    },
    payload = { projectId: p, id, expectedRevision: revision, ...value };
  return planningAttempt(actor, 'versions.release', payload, key, async () => {
    const current = await version(p, id),
      configured = await project(p);
    if (current.revision !== revision || current.releaseId) conflict();
    const o = value.observation;
    if (
      current.channel !== 'production' ||
      o.productionBranch !== value.productionBranch ||
      o.productionHead !== value.productionCommit ||
      o.tag !== value.tag ||
      o.tagCommit !== value.productionCommit ||
      value.tagCommit !== value.productionCommit ||
      o.versionCommit !== current.repositoryCommit ||
      !o.versionCommitIncluded
    )
      invalid(
        'Release erfordert einen passenden Produktionskandidaten sowie exakte Branch-, Tag- und Versionsfakten.',
      );
    if (
      value.productionBranch !== configured.production_branch ||
      o.repository !== configured.repository
    )
      conflict(
        'Die aktuelle Produktionskonfiguration passt nicht mehr zum Releaseversuch. Bitte neu laden.',
      );
    const ci = o.ci.filter((c) => c.headSha === value.productionCommit);
    if (!ci.length || ci.some((c) => c.conclusion !== 'success'))
      invalid(
        'Die aktuelle CI des Produktionscommits muss vollständig erfolgreich sein.',
      );
    const build = await getD1()
      .prepare(
        `SELECT ${buildJson()} AS data FROM version_builds b WHERE b.id=? AND b.version_id=? AND b.environment='production' AND b.outcome='available' AND NOT EXISTS(SELECT 1 FROM version_builds newer WHERE newer.version_id=b.version_id AND newer.kind=b.kind AND newer.environment=b.environment AND (newer.observed_at>b.observed_at OR newer.observed_at=b.observed_at AND newer.rowid>b.rowid))`,
      )
      .bind(value.buildId, id)
      .first<{ data: string }>();
    const built = build ? (JSON.parse(build.data) as BuildRecord) : null;
    if (!built)
      return conflict(
        'Der Produktionsbuild ist nicht mehr aktuell verfügbar. Bitte den Bereitstellungsstand neu laden.',
      );
    if (
      built.projectCommit !== value.productionCommit ||
      !built.versionCommitIncluded
    )
      invalid(
        'Ein aktuell verfügbarer Produktionsbuild desselben Produktionscommits und derselben Version ist erforderlich.',
      );
    const releaseId = crypto.randomUUID(),
      now = new Date().toISOString();
    return planningMutation<ReleaseRecord>({
      actor,
      operation: 'versions.release',
      payload,
      key,
      guard: sql(
        `EXISTS(SELECT 1 FROM project_versions WHERE id=? AND project_id=? AND revision=? AND release_id IS NULL) AND EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND revision=? AND repository=? AND production_branch=?) AND NOT EXISTS(SELECT 1 FROM version_releases WHERE project_id=? AND tag=?)`,
        id,
        p,
        revision,
        p,
        configured.revision,
        configured.repository,
        configured.production_branch,
        p,
        value.tag,
      ),
      writes: (gate) => [
        sql(
          `INSERT INTO version_releases(id,version_id,project_id,tag,payload_json,created_at) SELECT ?,?,?,?,?,? WHERE ${gate.sql}`,
          releaseId,
          id,
          p,
          value.tag,
          JSON.stringify(value),
          now,
          ...gate.params!,
        ),
        sql(
          `UPDATE project_versions SET release_id=? WHERE id=? AND ${gate.sql}`,
          releaseId,
          id,
          ...gate.params!,
        ),
        ...revisionWrites(gate, p, id),
      ],
      result: sql(
        `SELECT ${releaseJson()} FROM version_releases r WHERE r.id=?`,
        releaseId,
      ),
    });
  });
}
export async function getLatestAvailableVersion(
  actor: string,
  p: string,
): Promise<LatestAvailableVersion> {
  scope(actor, p);
  return planningStorage(async () => {
    const before = await project(p);
    const row = await getD1()
      .prepare(
        `SELECT ${versionJson()} AS version,${buildJson()} AS build FROM project_versions v JOIN version_builds b ON b.version_id=v.id WHERE v.project_id=? AND b.outcome='available' AND NOT EXISTS(SELECT 1 FROM version_builds newer WHERE newer.version_id=b.version_id AND newer.kind=b.kind AND newer.environment=b.environment AND (newer.observed_at>b.observed_at OR newer.observed_at=b.observed_at AND newer.rowid>b.rowid)) ORDER BY v.created_at DESC,v.rowid DESC,b.observed_at DESC,b.rowid DESC LIMIT 1`,
      )
      .bind(p)
      .first<{ version: string; build: string }>();
    const after = await project(p);
    if (before.versions_revision !== after.versions_revision) conflict();
    return row
      ? { version: JSON.parse(row.version), build: JSON.parse(row.build) }
      : null;
  });
}
