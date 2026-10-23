import { getD1 } from '@/lib/data/d1';
import type {
  Page,
  PageOptions,
  Project,
  ProjectInput,
} from '@/lib/domain/planning';
import {
  authorizePlanning,
  expectedRevision,
  PlanningError,
  planningId,
  planningMutation,
  planningPage,
  planningReplay,
  planningStorage,
  planningText,
  sql,
} from './planning-store';

export const projectJson = `json_object('id',id,'key',project_key,'name',name,'repository',repository,'integrationBranch',integration_branch,'productionBranch',production_branch,'documentationPaths',json(documentation_paths),'deploymentHints',deployment_hints,'revision',revision,'planningRevision',planning_revision,'nextOrderNumber',next_order_number)`;
function configuration(value: Omit<ProjectInput, 'key'>) {
  if (!value || typeof value !== 'object')
    throw new PlanningError('validation', 'Die Projektkonfiguration fehlt.');
  const name = planningText(value.name, 'Projektname', 280, true);
  const repository = planningText(value.repository, 'Repository', 1000, true);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    try {
      const url = new URL(repository);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname === '/'
      )
        throw new Error();
    } catch {
      throw new PlanningError(
        'validation',
        'Das Repository muss owner/name oder eine HTTPS-Adresse ohne Zugangsdaten sein.',
      );
    }
  }
  const integrationBranch = value.integrationBranch ?? 'develop';
  if (
    typeof integrationBranch !== 'string' ||
    integrationBranch.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(integrationBranch) ||
    /\.\.|\/\/|\/$|\.lock$/.test(integrationBranch)
  )
    throw new PlanningError(
      'validation',
      'Der Integrationsbranch ist ungültig.',
    );
  const productionBranch = value.productionBranch ?? 'main';
  if (!['main', 'master'].includes(productionBranch))
    throw new PlanningError(
      'validation',
      'Der Produktionsbranch muss main oder master sein.',
    );
  const documentationPaths = value.documentationPaths ?? [
    'README.md',
    'docs/features/README.md',
  ];
  if (
    !Array.isArray(documentationPaths) ||
    documentationPaths.length > 20 ||
    !documentationPaths.every(
      (path) =>
        typeof path === 'string' &&
        path.length > 0 &&
        path.length <= 256 &&
        !/^(?:\/|[A-Za-z]:)|\\/.test(path) &&
        !path
          .split('/')
          .some((part) => part === '..' || part === '.' || part === ''),
    )
  )
    throw new PlanningError(
      'validation',
      'Dokumentationspfade müssen relative Repositorypfade sein.',
    );
  const deploymentHints = planningText(
    value.deploymentHints ?? '',
    'Bereitstellungshinweise',
  );
  return {
    name,
    repository,
    integrationBranch,
    productionBranch,
    documentationPaths: [...new Set(documentationPaths)],
    deploymentHints,
  };
}

export async function registerProject(
  actor: string,
  input: ProjectInput,
  key: string,
): Promise<Project> {
  authorizePlanning(actor);
  if (
    !input ||
    typeof input.key !== 'string' ||
    !/^[A-Z][A-Z0-9]{1,19}$/.test(input.key)
  )
    throw new PlanningError(
      'validation',
      'Das dauerhafte Projektkürzel benötigt 2–20 Großbuchstaben/Ziffern.',
    );
  const config = configuration(input);
  const payload = { key: input.key, ...config };
  const id = crypto.randomUUID();
  return planningMutation({
    actor,
    operation: 'projects_register',
    payload,
    key,
    guard: sql(
      'NOT EXISTS(SELECT 1 FROM planning_projects WHERE project_key=?)',
      input.key,
    ),
    writes: (gate) => [
      sql(
        `INSERT INTO planning_projects(id,project_key,name,repository,integration_branch,production_branch,documentation_paths,deployment_hints,next_order_number) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate.sql}`,
        id,
        input.key,
        config.name,
        config.repository,
        config.integrationBranch,
        config.productionBranch,
        JSON.stringify(config.documentationPaths),
        config.deploymentHints,
        input.key === 'LUUFI' ? 13 : 1,
        ...(gate.params ?? []),
      ),
    ],
    result: sql(`SELECT ${projectJson} FROM planning_projects WHERE id=?`, id),
  });
}

export async function updateProject(
  actor: string,
  id: string,
  input: Omit<ProjectInput, 'key'>,
  revision: number,
  key: string,
): Promise<Project> {
  authorizePlanning(actor);
  planningId(id);
  expectedRevision(revision);
  const normalized = configuration(input);
  if ('key' in input)
    throw new PlanningError(
      'validation',
      'Das Projektkürzel ist unveränderlich.',
    );
  const intent = {
    name: normalized.name,
    repository: normalized.repository,
    ...Object.fromEntries(
      [
        'integrationBranch',
        'productionBranch',
        'documentationPaths',
        'deploymentHints',
      ]
        .filter((field) => input[field as keyof typeof input] !== undefined)
        .map((field) => [field, normalized[field as keyof typeof normalized]]),
    ),
  };
  const payload = { id, ...intent, expectedRevision: revision };
  const replay = await planningReplay<Project>(
    actor,
    'projects_update',
    payload,
    key,
  );
  if (replay !== undefined) return replay;
  const current = await getProject(actor, id);
  const config = configuration({ ...current, ...intent });
  return planningMutation({
    actor,
    operation: 'projects_update',
    payload,
    key,
    guard: sql(
      'EXISTS(SELECT 1 FROM planning_projects WHERE id=? AND revision=?)',
      id,
      revision,
    ),
    writes: (gate) => [
      sql(
        `UPDATE planning_projects SET name=?,repository=?,integration_branch=?,production_branch=?,documentation_paths=?,deployment_hints=?,revision=revision+1 WHERE id=? AND ${gate.sql}`,
        config.name,
        config.repository,
        config.integrationBranch,
        config.productionBranch,
        JSON.stringify(config.documentationPaths),
        config.deploymentHints,
        id,
        ...(gate.params ?? []),
      ),
    ],
    result: sql(`SELECT ${projectJson} FROM planning_projects WHERE id=?`, id),
  });
}

export async function getProject(actor: string, id: string): Promise<Project> {
  authorizePlanning(actor);
  planningId(id);
  return planningStorage(async () => {
    const result = await getD1()
      .prepare(
        `SELECT ${projectJson} AS data FROM planning_projects WHERE id=?`,
      )
      .bind(id)
      .first<{ data: string }>();
    if (!result)
      throw new PlanningError(
        'not_found',
        'Dieses Projekt wurde nicht gefunden.',
      );
    return JSON.parse(result.data) as Project;
  });
}

export async function listProjects(
  actor: string,
  options: PageOptions = {},
): Promise<Page<Project>> {
  authorizePlanning(actor);
  return planningStorage(async () => {
    const db = getD1();
    const revisionSql =
      'SELECT COALESCE(SUM(revision+planning_revision+1),0) AS revision FROM planning_projects';
    const revision = (await db
      .prepare(revisionSql)
      .first<{ revision: number }>())!.revision;
    const page = planningPage(options, 'projects', revision);
    const results = await db.batch([
      db.prepare(revisionSql),
      db
        .prepare(
          `SELECT ${projectJson} AS data FROM planning_projects ORDER BY project_key,id LIMIT ? OFFSET ?`,
        )
        .bind(page.limit + 1, page.offset),
    ]);
    if ((results[0].results[0] as { revision: number }).revision !== revision)
      throw new PlanningError(
        'conflict',
        'Die Projekte wurden inzwischen geändert. Bitte neu laden.',
      );
    const rows = results[1].results as { data: string }[];
    return {
      items: rows
        .slice(0, page.limit)
        .map((row) => JSON.parse(row.data) as Project),
      nextCursor: page.next(rows.length > page.limit),
    };
  });
}
