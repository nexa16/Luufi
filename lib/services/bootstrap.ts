import { getD1 } from '@/lib/data/d1';
import {
  bootstrapManifestVersion,
  bootstrapMilestones,
  bootstrapOrders,
  bootstrapProjectId,
} from '@/lib/domain/bootstrap';
import type {
  BootstrapEntry,
  BootstrapProof,
  BootstrapStatus,
} from '@/lib/domain/releases';
import { bootstrapJson } from './releases-sql';
import {
  authorizePlanning,
  PlanningError,
  planningAttempt,
  planningId,
  planningMutation,
  planningStorage,
  planningText,
  sql,
} from './planning-store';

type Row = Record<string, string | number | null>;
type Inventory = {
  projects: Row[];
  milestones: Row[];
  orders: Row[];
  versions: Row[];
  provenance: Row[];
};
function conflict(target: string): never {
  throw new PlanningError(
    'conflict',
    `Bootstrap-Konflikt bei ${target}. Vorhandene Daten werden nicht überschrieben.`,
  );
}
function fields(input: unknown, allowed: string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new PlanningError(
      'validation',
      'Der Bootstrap-Nachweis enthält ungültige Felder.',
    );
}
const canonical = (value: unknown): string =>
  JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((item) => JSON.parse(canonical(item)))
        : Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, JSON.parse(canonical(item))]),
          )
      : value,
  );
function sha(input: unknown) {
  if (typeof input !== 'string' || !/^[a-fA-F0-9]{40}$/.test(input))
    throw new PlanningError(
      'validation',
      'Ein vollständiger Bootstrap-Commit-SHA ist erforderlich.',
    );
  return input.toLowerCase();
}
function normalizeProof(input: BootstrapProof): BootstrapProof {
  fields(input, [
    'number',
    'kind',
    'implementationCommit',
    'integrationCommit',
    'prUrl',
    'ciUrl',
    'sourceCommit',
    'verificationReference',
    'verifiedAt',
  ]);
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > 18)
    throw new PlanningError(
      'validation',
      'Nur feste Bootstrapnummern 1–18 sind erlaubt.',
    );
  const sites = input.number === 1;
  if (input.kind !== (sites ? 'sites-proof' : 'public-git'))
    throw new PlanningError(
      'validation',
      'LUUFI-1 benötigt Sites-Provenienz; 2–18 benötigen öffentliche Git-Provenienz.',
    );
  if (
    sites &&
    [
      input.implementationCommit,
      input.integrationCommit,
      input.prUrl,
      input.ciUrl,
    ].some((value) => value !== null)
  )
    throw new PlanningError(
      'validation',
      'Der private Sites-Proof darf keine öffentlichen Git-/PR-/CI-Nachweise vortäuschen.',
    );
  if (
    !sites &&
    (!/^https:\/\/github\.com\/nexa16\/Luufi\/pull\/[1-9]\d*$/.test(
      input.prUrl ?? '',
    ) ||
      !/^https:\/\/github\.com\/nexa16\/Luufi\/actions\/runs\/[1-9]\d*(?:\/job\/[1-9]\d*)?$/.test(
        input.ciUrl ?? '',
      ))
  )
    throw new PlanningError(
      'validation',
      'Bootstrap-PR und CI müssen konkrete Luufi-GitHub-Nachweise sein.',
    );
  if (
    typeof input.verifiedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(input.verifiedAt) ||
    !Number.isFinite(Date.parse(input.verifiedAt))
  )
    throw new PlanningError(
      'validation',
      'Der tatsächliche Bootstrap-Prüfzeitpunkt fehlt.',
    );
  return {
    number: input.number,
    kind: input.kind,
    implementationCommit: sites ? null : sha(input.implementationCommit),
    integrationCommit: sites ? null : sha(input.integrationCommit),
    prUrl: sites ? null : input.prUrl,
    ciUrl: sites ? null : input.ciUrl,
    sourceCommit: sha(input.sourceCommit),
    verificationReference: planningText(
      input.verificationReference,
      'Tatsächlicher Prüfverweis',
      1000,
      true,
    ),
    verifiedAt: new Date(input.verifiedAt).toISOString(),
  };
}
const orderIds = bootstrapOrders.map((order) => `'${order.id}'`).join(','),
  milestoneIds = bootstrapMilestones.map((m) => `'${m.id}'`).join(',');
function array(table: string, columns: string[], where: string, order: string) {
  return `(SELECT json_group_array(json(data)) FROM (SELECT json_object(${columns.map((column) => `'${column}',${column}`).join(',')}) AS data FROM ${table} WHERE ${where} ORDER BY ${order}))`;
}
function inventoryExpression() {
  const projects = array(
    'planning_projects',
    [
      'id',
      'project_key',
      'repository',
      'integration_branch',
      'production_branch',
      'revision',
      'planning_revision',
      'next_order_number',
    ],
    "project_key='LUUFI' OR id=?",
    'id',
  );
  const milestones = array(
    'planning_milestones',
    [
      'id',
      'project_id',
      'title',
      'description',
      'state',
      'position',
      'revision',
    ],
    `project_id=? OR id IN (${milestoneIds})`,
    'id',
  );
  const orders = array(
    'planning_orders',
    [
      'id',
      'project_id',
      'number',
      'type',
      'status',
      'spec_version',
      'revision',
      'milestone_id',
      'position',
      'lifecycle_revision',
      'current_implementation_id',
      'integration_id',
    ],
    `(project_id=? AND number BETWEEN 1 AND 18) OR id IN (${orderIds})`,
    'id',
  );
  const versions = array(
    'planning_order_versions',
    ['order_id', 'version', 'spec_json', 'created_at'],
    `order_id IN (SELECT id FROM planning_orders WHERE (project_id=? AND number BETWEEN 1 AND 18) OR id IN (${orderIds}))`,
    'order_id,version',
  );
  const provenance = array(
    'bootstrap_provenance',
    [
      'order_id',
      'number',
      'kind',
      'implementation_commit',
      'integration_commit',
      'pr_url',
      'ci_url',
      'source_commit',
      'verification_reference',
      'verified_at',
      'manifest_version',
      'created_at',
    ],
    `number BETWEEN 1 AND 18 OR order_id IN (${orderIds})`,
    'number',
  );
  return `json_object('projects',json(${projects}),'milestones',json(${milestones}),'orders',json(${orders}),'versions',json(${versions}),'provenance',json(${provenance}))`;
}
async function inventory(p: string) {
  const row = await getD1()
    .prepare(`SELECT ${inventoryExpression()} AS data`)
    .bind(p, p, p, p)
    .first<{ data: string }>();
  return { serialized: row!.data, value: JSON.parse(row!.data) as Inventory };
}
function proofRow(row: Row): BootstrapProof {
  return {
    number: Number(row.number),
    kind: row.kind as BootstrapProof['kind'],
    implementationCommit: row.implementation_commit as string | null,
    integrationCommit: row.integration_commit as string | null,
    prUrl: row.pr_url as string | null,
    ciUrl: row.ci_url as string | null,
    sourceCommit: String(row.source_commit),
    verificationReference: String(row.verification_reference),
    verifiedAt: String(row.verified_at),
  };
}
function validateInventory(
  p: string,
  current: Inventory,
  proofs?: BootstrapProof[],
) {
  if (current.projects.length > 1)
    conflict('Projektkennung LUUFI oder fester Projekt-ID');
  for (const row of current.projects)
    if (
      row.id !== p ||
      row.project_key !== 'LUUFI' ||
      row.repository !== 'nexa16/Luufi' ||
      row.integration_branch !== 'develop' ||
      row.production_branch !== 'main'
    )
      conflict(`Projekt ${row.id}`);
  for (const row of current.milestones) {
    const wanted = bootstrapMilestones.find((m) => m.id === row.id);
    if (!wanted) {
      if (Number(row.position) < 5)
        conflict(`Milestone ${row.id} an reservierter Position`);
      continue;
    }
    if (
      row.project_id !== p ||
      row.title !== wanted.title ||
      row.description !== wanted.description ||
      row.state !== 'closed' ||
      row.position !== wanted.position
    )
      conflict(`Milestone ${row.id}`);
  }
  for (const row of current.orders) {
    const wanted = bootstrapOrders.find((order) => order.id === row.id);
    if (
      !wanted ||
      row.project_id !== p ||
      row.number !== wanted.number ||
      row.type !== wanted.type ||
      row.status !== 'done' ||
      row.spec_version !== 1 ||
      row.milestone_id !== wanted.milestoneId ||
      row.position !== wanted.position
    )
      conflict(`Auftrag LUUFI-${row.number} / ${row.id}`);
  }
  for (const row of current.versions) {
    const wanted = bootstrapOrders.find((order) => order.id === row.order_id);
    if (!wanted || row.version !== 1) conflict(`Fassung von ${row.order_id}`);
    try {
      if (
        canonical(JSON.parse(String(row.spec_json))) !== canonical(wanted.spec)
      )
        conflict(`Spezifikation ${row.order_id}`);
    } catch {
      conflict(`Spezifikation ${row.order_id}`);
    }
  }
  for (const row of current.provenance) {
    const wanted = bootstrapOrders.find((order) => order.number === row.number);
    if (
      !wanted ||
      row.order_id !== wanted.id ||
      row.manifest_version !== bootstrapManifestVersion
    )
      conflict(`Provenienz LUUFI-${row.number}`);
    let normalized: BootstrapProof;
    try {
      normalized = normalizeProof(proofRow(row));
    } catch {
      conflict(`Provenienz LUUFI-${row.number}`);
    }
    const proof = proofs?.find((proof) => proof.number === row.number);
    if (proof && canonical(normalized!) !== canonical(proof))
      conflict(`abweichendem Nachweis LUUFI-${row.number}`);
  }
}
function status(p: string | null, current?: Inventory): BootstrapStatus {
  const installedCount =
    current?.provenance.filter(
      (row) =>
        row.manifest_version === bootstrapManifestVersion &&
        current.orders.some(
          (order) =>
            order.id === row.order_id &&
            order.number === row.number &&
            order.status === 'done' &&
            order.spec_version === 1,
        ),
    ).length ?? 0;
  let complete =
    !!current &&
    installedCount === 18 &&
    current.orders.length === 18 &&
    current.versions.length === 18 &&
    bootstrapMilestones.every((m) =>
      current.milestones.some((row) => row.id === m.id),
    );
  if (complete)
    try {
      validateInventory(p!, current!);
    } catch {
      complete = false;
    }
  return {
    projectId: p,
    manifestVersion: bootstrapManifestVersion,
    expectedCount: 18,
    installedCount,
    complete,
  };
}
const resultSql = (p: string) =>
  sql(
    `SELECT json_object('projectId',?,'manifestVersion',?,'expectedCount',18,'installedCount',18,'complete',json('true')) WHERE EXISTS(SELECT 1 FROM planning_projects WHERE id=?) AND (SELECT count(*) FROM bootstrap_provenance b JOIN planning_orders o ON o.id=b.order_id WHERE o.project_id=? AND o.status='done' AND o.number=b.number AND b.manifest_version=?)=18`,
    p,
    bootstrapManifestVersion,
    p,
    p,
    bootstrapManifestVersion,
  );
export async function getBootstrapStatus(
  actor: string,
): Promise<BootstrapStatus> {
  authorizePlanning(actor);
  return planningStorage(async () => {
    const project = await getD1()
      .prepare("SELECT id FROM planning_projects WHERE project_key='LUUFI'")
      .first<{ id: string }>();
    return project
      ? status(project.id, (await inventory(project.id)).value)
      : status(null);
  });
}
export async function reconcileBootstrap(
  actor: string,
  proofs: BootstrapProof[],
  confirmationReference: string,
  requestKey: string,
): Promise<BootstrapStatus> {
  authorizePlanning(actor);
  if (!Array.isArray(proofs) || proofs.length !== 18)
    throw new PlanningError(
      'validation',
      'Der feste Bootstrap benötigt genau 18 vollständige Nachweise.',
    );
  const normalized = proofs
    .map(normalizeProof)
    .sort((a, b) => a.number - b.number);
  if (new Set(normalized.map((p) => p.number)).size !== 18)
    throw new PlanningError(
      'validation',
      'Jede Bootstrapnummer 1–18 muss genau einmal vorkommen.',
    );
  const confirmation = planningText(
      confirmationReference,
      'Ausdrückliche Bootstrapbestätigung',
      1000,
      true,
    ),
    payload = {
      manifestVersion: bootstrapManifestVersion,
      proofs: normalized,
      confirmationReference: confirmation,
    };
  return planningAttempt(
    actor,
    'bootstrap.reconcile',
    payload,
    requestKey,
    async () => {
      const db = getD1(),
        project = await db
          .prepare("SELECT id FROM planning_projects WHERE project_key='LUUFI'")
          .first<{ id: string }>(),
        p = project?.id ?? bootstrapProjectId,
        current = await inventory(p);
      validateInventory(p, current.value, normalized);
      const missing =
          !status(p, current.value).complete ||
          Number(current.value.projects[0]?.next_order_number ?? 0) < 19,
        now = new Date().toISOString();
      return planningMutation({
        actor,
        operation: 'bootstrap.reconcile',
        payload,
        key: requestKey,
        guard: sql(
          `(${inventoryExpression()})=?`,
          p,
          p,
          p,
          p,
          current.serialized,
        ),
        writes: (gate) => [
          sql(
            `INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints,next_order_number) SELECT ?,'LUUFI','Luufi','nexa16/Luufi','develop','main','["README.md","docs/features/README.md"]','',19 WHERE NOT EXISTS(SELECT 1 FROM planning_projects WHERE id=?) AND (${gate.sql})`,
            p,
            p,
            ...gate.params!,
          ),
          ...bootstrapMilestones.map((m) =>
            sql(
              `INSERT INTO planning_milestones(id,project_id,title,description,state,position,revision) SELECT ?,?,?,?,'closed',?,0 WHERE NOT EXISTS(SELECT 1 FROM planning_milestones WHERE id=?) AND (${gate.sql})`,
              m.id,
              p,
              m.title,
              m.description,
              m.position,
              m.id,
              ...gate.params!,
            ),
          ),
          ...bootstrapOrders.flatMap((order) => [
            sql(
              `INSERT INTO planning_orders(id,project_id,number,type,status,spec_version,revision,milestone_id,position) SELECT ?,?,?,?,'done',1,0,?,? WHERE NOT EXISTS(SELECT 1 FROM planning_orders WHERE id=?) AND (${gate.sql})`,
              order.id,
              p,
              order.number,
              order.type,
              order.milestoneId,
              order.position,
              order.id,
              ...gate.params!,
            ),
            sql(
              `INSERT INTO planning_order_versions(order_id,version,spec_json,created_at) SELECT ?,1,?,? WHERE NOT EXISTS(SELECT 1 FROM planning_order_versions WHERE order_id=? AND version=1) AND (${gate.sql})`,
              order.id,
              JSON.stringify(order.spec),
              now,
              order.id,
              ...gate.params!,
            ),
          ]),
          ...normalized.map((proof) =>
            sql(
              `INSERT INTO bootstrap_provenance(order_id,number,kind,implementation_commit,integration_commit,pr_url,ci_url,source_commit,verification_reference,verified_at,manifest_version,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM bootstrap_provenance WHERE order_id=?) AND (${gate.sql})`,
              bootstrapOrders[proof.number - 1].id,
              proof.number,
              proof.kind,
              proof.implementationCommit,
              proof.integrationCommit,
              proof.prUrl,
              proof.ciUrl,
              proof.sourceCommit,
              proof.verificationReference,
              proof.verifiedAt,
              bootstrapManifestVersion,
              now,
              bootstrapOrders[proof.number - 1].id,
              ...gate.params!,
            ),
          ),
          sql(
            `UPDATE planning_projects SET next_order_number=MAX(next_order_number,19),planning_revision=planning_revision+? WHERE id=? AND (${gate.sql})`,
            missing ? 1 : 0,
            p,
            ...gate.params!,
          ),
        ],
        result: resultSql(p),
      });
    },
  );
}
export async function getOrderBootstrapProvenance(
  actor: string,
  p: string,
  id: string,
): Promise<BootstrapEntry | null> {
  authorizePlanning(actor);
  planningId(p);
  planningId(id);
  return planningStorage(async () => {
    const order = await getD1()
      .prepare(
        'SELECT o.number,o.status,o.spec_version,p.project_key,p.repository,p.integration_branch,p.production_branch FROM planning_orders o JOIN planning_projects p ON p.id=o.project_id WHERE o.project_id=? AND o.id=?',
      )
      .bind(p, id)
      .first<{
        number: number;
        status: string;
        spec_version: number;
        project_key: string;
        repository: string;
        integration_branch: string;
        production_branch: string;
      }>();
    if (!order)
      throw new PlanningError(
        'not_found',
        'Dieser Auftrag wurde nicht gefunden.',
      );
    const row = await getD1()
      .prepare(
        `SELECT ${bootstrapJson()} AS data,b.* FROM bootstrap_provenance b JOIN planning_orders o ON o.id=b.order_id WHERE o.project_id=? AND o.id=?`,
      )
      .bind(p, id)
      .first<Row & { data: string }>();
    if (!row) return null;
    if (
      order.status !== 'done' ||
      order.spec_version !== 1 ||
      order.number !== row.number ||
      id !== bootstrapOrders[order.number - 1]?.id ||
      order.project_key !== 'LUUFI' ||
      order.repository !== 'nexa16/Luufi' ||
      order.integration_branch !== 'develop' ||
      order.production_branch !== 'main' ||
      row.manifest_version !== bootstrapManifestVersion
    )
      conflict(`Provenienzstatus ${id}`);
    try {
      normalizeProof(proofRow(row));
    } catch {
      conflict(`Provenienzinhalt ${id}`);
    }
    return JSON.parse(row.data) as BootstrapEntry;
  });
}
