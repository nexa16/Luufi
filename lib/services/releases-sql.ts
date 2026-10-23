// Aliases are code-owned constants, never native caller input.
export const versionJson = (v = 'v') =>
  `json_object('id',${v}.id,'projectId',${v}.project_id,'label',${v}.label,'channel',${v}.channel,'title',${v}.title,'changelog',${v}.changelog,'repositoryCommit',${v}.repository_commit,'sourceBranch',${v}.source_branch,'orderCount',(SELECT count(*) FROM version_orders WHERE version_id=${v}.id),'revision',${v}.revision,'releaseId',${v}.release_id,'createdAt',${v}.created_at)`;
export const versionOrderJson = (o = 'o') =>
  `json_object('id',${o}.id,'versionId',${o}.version_id,'orderId',${o}.order_id,'displayId',${o}.display_id,'title',${o}.title,'specVersion',${o}.spec_version,'implementationId',${o}.implementation_id,'integrationId',${o}.integration_id,'implementationCommit',${o}.implementation_commit,'integrationReference',${o}.integration_reference,'provenanceKind',${o}.provenance_kind)`;
export const buildJson = (b = 'b') =>
  `json_set(json(${b}.payload_json),'$.id',${b}.id,'$.versionId',${b}.version_id,'$.kind',${b}.kind,'$.environment',${b}.environment,'$.outcome',${b}.outcome,'$.observedAt',${b}.observed_at,'$.createdAt',${b}.created_at)`;
export const releaseJson = (r = 'r') =>
  `json_set(json(${r}.payload_json),'$.id',${r}.id,'$.versionId',${r}.version_id,'$.tag',${r}.tag,'$.createdAt',${r}.created_at)`;
export const bootstrapJson = (b = 'b', o = 'o') =>
  `json_object('number',${b}.number,'kind',${b}.kind,'implementationCommit',${b}.implementation_commit,'integrationCommit',${b}.integration_commit,'prUrl',${b}.pr_url,'ciUrl',${b}.ci_url,'sourceCommit',${b}.source_commit,'verificationReference',${b}.verification_reference,'verifiedAt',${b}.verified_at,'orderId',${o}.id,'displayId',(SELECT project_key FROM planning_projects WHERE id=${o}.project_id)||'-'||${o}.number,'specVersion',${o}.spec_version,'manifestVersion',${b}.manifest_version,'createdAt',${b}.created_at)`;
