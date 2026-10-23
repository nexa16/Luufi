const fullCommitSha = /^[0-9a-f]{40}$/;

export type DeploymentIdentity = {
  commitSha: string;
  environment: 'preview' | 'production';
  sourceBranch: string;
};

export type DeploymentIdentityBindings = {
  LUUFI_COMMIT_SHA?: string;
  LUUFI_ENVIRONMENT?: string;
  LUUFI_SOURCE_BRANCH?: string;
  LUUFI_SOURCE_KIND?: string;
};

export function deploymentIdentity(
  bindings: DeploymentIdentityBindings,
): DeploymentIdentity | null {
  const commitSha = bindings.LUUFI_COMMIT_SHA?.trim().toLowerCase();
  const environment = bindings.LUUFI_ENVIRONMENT?.trim().toLowerCase();
  const sourceBranch = bindings.LUUFI_SOURCE_BRANCH?.trim();

  if (!commitSha || !fullCommitSha.test(commitSha)) return null;
  if (environment !== 'preview' && environment !== 'production') return null;
  if (!sourceBranch) return null;

  if (environment === 'production' && sourceBranch !== 'main') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(sourceBranch)) return null;

  return { commitSha, environment, sourceBranch };
}

/** Readiness inspects the active database without reading personal idea content. */
export async function platformReadiness(
  bindings: DeploymentIdentityBindings & { DB: D1Database },
) {
  const identity = deploymentIdentity(bindings);
  if (!identity) return { status: 'unavailable' as const };
  try {
    const connection = await bindings.DB.prepare('SELECT 1 AS ready').first<{
      ready: number;
    }>();
    if (connection?.ready !== 1) return { status: 'unavailable' as const };
    // SELECT against the actual required table also verifies its expected columns.
    await bindings.DB.prepare(
      'SELECT id, idea_text, detail, created_at, revision FROM project_ideas LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT request_key, operation, payload_json, result_json FROM idea_mutation_requests LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT id, project_key, planning_revision, next_order_number FROM planning_projects LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT id, project_id, position, revision FROM planning_milestones LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT id, project_id, number, spec_version, revision FROM planning_orders LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT order_id, version, spec_json FROM planning_order_versions LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT source_id, target_id, type FROM planning_order_relations LIMIT 0',
    ).all();
    await bindings.DB.prepare(
      'SELECT request_key, actor, operation, payload_json, result_json FROM planning_requests LIMIT 0',
    ).all();
    return { status: 'ok' as const, ...identity };
  } catch {
    return { status: 'unavailable' as const };
  }
}
