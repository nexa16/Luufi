import type { OrderStatus } from './planning';
export type ApprovalMode = 'selection' | 'milestone';
export type ApprovalInput = {
  mode: ApprovalMode;
  orderIds?: string[];
  milestoneId?: string;
  confirmationReference: string;
};
export type Approval = {
  id: string;
  projectId: string;
  revision: number;
  mode: ApprovalMode;
  milestoneId: string | null;
  confirmationReference: string;
  itemCount: number;
  createdAt: string;
  revokedAt: string | null;
};
export type ApprovalScope = {
  orderId: string;
  specVersion: number;
  title: string;
  dependencyIds: string[];
  repository: string;
  integrationBranch: string;
  invalidatedAt: string | null;
  invalidatedReason: string;
};
export type OrderApproval = Approval & {
  scope: ApprovalScope;
  valid: boolean;
  reason: string;
};
export type Execution = {
  id: string;
  projectId: string;
  orderId: string;
  specVersion: number;
  approvalId: string;
  worker: string;
  branch: string;
  generation: number;
  revision: number;
  phase: 'active' | 'paused' | 'closed';
  createdAt: string;
  updatedAt: string;
};
export type ProgressInput = {
  kind: 'update' | 'obstacle' | 'test' | 'handover';
  text: string;
  nextAction: string;
};
export type Progress = ProgressInput & {
  id: string;
  orderId: string;
  executionId: string;
  generation: number;
  createdAt: string;
};
export type LifecycleEvent = {
  id: string;
  orderId: string;
  specVersion: number;
  actor: string;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
  reason: string;
  reference: string;
  details: Record<string, unknown>;
  createdAt: string;
};
export type LifecycleSummary = {
  orderId: string;
  revision: number;
  lifecycleRevision: number;
  approval: {
    id: string;
    specVersion: number;
    valid: boolean;
    reason: string;
  } | null;
  execution: Execution | null;
  currentImplementationId: string | null;
  integrationId: string | null;
};
export type GitObservation = {
  repository: string;
  branch: string;
  remoteRef: string;
  headSha: string;
  commitSha: string;
  observedAt: string;
  source: 'codex-local-git';
  commitSubject: string;
  parentShas: string[];
  ancestorOfHead: boolean;
  pushed: boolean;
  pr: {
    url: string;
    baseBranch: string;
    headSha: string;
    merged: boolean;
    mergeSha: string | null;
    normalMerge: boolean;
  } | null;
  ci: {
    url: string;
    name: string;
    headSha: string;
    conclusion: 'success' | 'failure' | 'cancelled' | 'pending';
  }[];
};
export type CriterionEvidence = {
  id: string;
  result: 'pass' | 'fail' | 'manual-only';
  reference: string;
};
export type EvidenceInput = {
  outcome: 'success' | 'failure' | 'unavailable';
  executionId: string;
  generation: number;
  commitSha: string;
  summary: string;
  criteria: CriterionEvidence[];
  documentationReference: string;
  observation: GitObservation | null;
  validationId?: string;
  unavailableBuildReason?: string;
  supersedesId?: string;
};
export type Evidence = Omit<
  EvidenceInput,
  'validationId' | 'unavailableBuildReason' | 'supersedesId'
> & {
  id: string;
  orderId: string;
  specVersion: number;
  kind: 'validation' | 'implementation' | 'integration';
  validationId: string | null;
  unavailableBuildReason: string;
  supersedesId: string | null;
  createdAt: string;
};
