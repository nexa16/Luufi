export type Page<T> = { items: T[]; nextCursor: string | null };
export type PageOptions = { limit?: number; cursor?: string | null };
export type ProjectInput = {
  key: string;
  name: string;
  repository: string;
  integrationBranch?: string;
  productionBranch?: 'main' | 'master';
  documentationPaths?: string[];
  deploymentHints?: string;
};
export type Project = {
  id: string;
  key: string;
  name: string;
  repository: string;
  integrationBranch: string;
  productionBranch: 'main' | 'master';
  documentationPaths: string[];
  deploymentHints: string;
  revision: number;
  planningRevision: number;
  nextOrderNumber: number;
};
export type Milestone = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  state: 'open' | 'closed';
  position: number;
  revision: number;
};
export const orderTypes = [
  'feature',
  'improvement',
  'defect',
  'technical',
] as const;
export type OrderType = (typeof orderTypes)[number];
export const orderStatuses = [
  'draft',
  'ready',
  'implementing',
  'implemented',
  'done',
  'archived',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export type OrderSpec = {
  title: string;
  goal: string;
  origin: string;
  problem: string;
  scope: string;
  exclusions: string;
  flows: string;
  criteria: { id: string; text: string }[];
  testStrategy: string;
  prerequisites: string;
  documentation: string;
  context: { repositoryCommit: string; documentationPolicy: string };
  sources: string[];
};
export type OrderVersion = {
  version: number;
  spec: OrderSpec;
  createdAt: string;
};
export const relationTypes = [
  'depends_on',
  'related',
  'originated_from',
  'replaces',
] as const;
export type RelationType = (typeof relationTypes)[number];
export type OrderRelation = { targetId: string; type: RelationType };
export type Order = {
  id: string;
  projectId: string;
  number: number;
  displayId: string;
  type: OrderType;
  status: OrderStatus;
  specVersion: number;
  revision: number;
  milestoneId: string | null;
  position: number;
  spec: OrderSpec;
  history: OrderVersion[];
  relations: OrderRelation[];
};
export type OrderFilters = PageOptions & {
  milestoneId?: string | null;
  status?: OrderStatus;
  type?: OrderType;
};
