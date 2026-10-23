export type VersionScope = {
  mode: 'selection' | 'milestone';
  orderIds?: string[];
  milestoneId?: string;
};
export type VersionInput = {
  label: string;
  channel: 'develop' | 'production';
  title: string;
  changelog: string;
  repositoryCommit: string;
  sourceBranch: string;
  scope: VersionScope;
};
export type ProjectVersion = {
  id: string;
  projectId: string;
  label: string;
  channel: 'develop' | 'production';
  title: string;
  changelog: string;
  repositoryCommit: string;
  sourceBranch: string;
  orderCount: number;
  revision: number;
  releaseId: string | null;
  createdAt: string;
};
export type VersionOrder = {
  id: string;
  versionId: string;
  orderId: string;
  displayId: string;
  title: string;
  specVersion: number;
  implementationId: string | null;
  integrationId: string | null;
  implementationCommit: string;
  integrationReference: string;
  provenanceKind: 'execution' | 'bootstrap';
};
export type BuildInput = {
  kind: 'site' | 'apk';
  outcome: 'available' | 'unavailable' | 'failure';
  url: string | null;
  reason: string;
  environment: 'preview' | 'production';
  projectCommit: string;
  sourceKind: 'github' | 'sites';
  sourceBranch: string;
  sourceCommit: string;
  versionCommitIncluded: boolean;
  mappingReference: string;
  observedAt: string;
  verificationReference: string;
};
export type BuildRecord = BuildInput & {
  id: string;
  versionId: string;
  createdAt: string;
};
export type ReleaseObservation = {
  repository: string;
  productionBranch: string;
  productionHead: string;
  tag: string;
  tagCommit: string;
  versionCommit: string;
  versionCommitIncluded: boolean;
  observedAt: string;
  source: 'codex-local-git';
  ci: {
    url: string;
    name: string;
    headSha: string;
    conclusion: 'success' | 'failure' | 'cancelled' | 'pending';
  }[];
};
export type ReleaseInput = {
  confirmationReference: string;
  productionBranch: string;
  productionCommit: string;
  tag: string;
  tagCommit: string;
  buildId: string;
  observation: ReleaseObservation;
  deploymentReference: string;
};
export type ReleaseRecord = ReleaseInput & {
  id: string;
  versionId: string;
  createdAt: string;
};
export type LatestAvailableVersion = {
  version: ProjectVersion;
  build: BuildRecord;
} | null;
export type BootstrapProof = {
  number: number;
  kind: 'sites-proof' | 'public-git';
  implementationCommit: string | null;
  integrationCommit: string | null;
  prUrl: string | null;
  ciUrl: string | null;
  sourceCommit: string;
  verificationReference: string;
  verifiedAt: string;
};
export type BootstrapEntry = BootstrapProof & {
  orderId: string;
  displayId: string;
  specVersion: number;
  manifestVersion: string;
  createdAt: string;
};
export type BootstrapStatus = {
  projectId: string | null;
  manifestVersion: string;
  expectedCount: 18;
  installedCount: number;
  complete: boolean;
};
