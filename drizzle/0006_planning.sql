CREATE TABLE planning_projects (
  id TEXT PRIMARY KEY NOT NULL,
  project_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  repository TEXT NOT NULL,
  integration_branch TEXT NOT NULL,
  production_branch TEXT NOT NULL CHECK (production_branch IN ('main','master')),
  documentation_paths TEXT NOT NULL,
  deployment_hints TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  planning_revision INTEGER NOT NULL DEFAULT 0,
  next_order_number INTEGER NOT NULL DEFAULT 1 CHECK (next_order_number > 0)
);
--> statement-breakpoint
CREATE TABLE planning_milestones (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES planning_projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  position INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX planning_milestones_project ON planning_milestones(project_id, position, id);
--> statement-breakpoint
CREATE TABLE planning_orders (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES planning_projects(id),
  number INTEGER NOT NULL CHECK (number > 0),
  type TEXT NOT NULL CHECK (type IN ('feature','improvement','defect','technical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','implementing','implemented','done','archived')),
  spec_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  milestone_id TEXT REFERENCES planning_milestones(id),
  position INTEGER NOT NULL,
  UNIQUE(project_id, number)
);
--> statement-breakpoint
CREATE INDEX planning_orders_project ON planning_orders(project_id, milestone_id, position, id);
--> statement-breakpoint
CREATE TABLE planning_order_versions (
  order_id TEXT NOT NULL REFERENCES planning_orders(id),
  version INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(order_id, version)
);
--> statement-breakpoint
CREATE TABLE planning_order_relations (
  source_id TEXT NOT NULL REFERENCES planning_orders(id),
  target_id TEXT NOT NULL REFERENCES planning_orders(id),
  type TEXT NOT NULL CHECK (type IN ('depends_on','related','originated_from','replaces')),
  PRIMARY KEY(source_id, target_id, type),
  CHECK (source_id != target_id)
);
--> statement-breakpoint
CREATE TABLE planning_requests (
  request_key TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT
);
