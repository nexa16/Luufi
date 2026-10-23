ALTER TABLE planning_orders ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE planning_orders ADD COLUMN current_implementation_id TEXT;
--> statement-breakpoint
ALTER TABLE planning_orders ADD COLUMN integration_id TEXT;
--> statement-breakpoint
CREATE TABLE order_approvals (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES planning_projects(id),
 revision INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL CHECK(mode IN ('selection','milestone')),
 milestone_id TEXT REFERENCES planning_milestones(id), confirmation_reference TEXT NOT NULL,
 created_at TEXT NOT NULL, revoked_at TEXT
);
--> statement-breakpoint
CREATE TABLE order_approval_items (
 approval_id TEXT NOT NULL REFERENCES order_approvals(id), order_id TEXT NOT NULL REFERENCES planning_orders(id),
 spec_version INTEGER NOT NULL, title TEXT NOT NULL, dependency_ids_json TEXT NOT NULL,
 repository TEXT NOT NULL, integration_branch TEXT NOT NULL,
 invalidated_at TEXT, invalidated_reason TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(approval_id,order_id)
);
--> statement-breakpoint
CREATE INDEX order_approval_items_order ON order_approval_items(order_id,approval_id);
--> statement-breakpoint
CREATE TABLE order_executions (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES planning_projects(id),
 order_id TEXT NOT NULL REFERENCES planning_orders(id), spec_version INTEGER NOT NULL,
 approval_id TEXT NOT NULL REFERENCES order_approvals(id), worker TEXT NOT NULL, branch TEXT NOT NULL,
 generation INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 phase TEXT NOT NULL CHECK(phase IN ('active','paused','closed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX order_one_execution ON order_executions(order_id) WHERE phase IN ('active','paused');
--> statement-breakpoint
CREATE TABLE order_progress (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL REFERENCES planning_orders(id),
 execution_id TEXT NOT NULL REFERENCES order_executions(id), generation INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('update','obstacle','test','handover')),
 text TEXT NOT NULL, next_action TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX order_progress_order ON order_progress(order_id,created_at,id);
--> statement-breakpoint
CREATE TABLE order_lifecycle_events (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL REFERENCES planning_orders(id),
 spec_version INTEGER NOT NULL, actor TEXT NOT NULL, previous_status TEXT NOT NULL, next_status TEXT NOT NULL,
 reason TEXT NOT NULL, reference TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX order_lifecycle_events_order ON order_lifecycle_events(order_id,created_at,id);
--> statement-breakpoint
CREATE TABLE order_evidence (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL REFERENCES planning_orders(id),
 spec_version INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('validation','implementation','integration')),
 outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','unavailable')),
 execution_id TEXT NOT NULL REFERENCES order_executions(id), generation INTEGER NOT NULL,
 payload_json TEXT NOT NULL, supersedes_id TEXT REFERENCES order_evidence(id), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX order_evidence_order ON order_evidence(order_id,created_at,id);

--> statement-breakpoint
UPDATE planning_projects SET next_order_number=MAX(next_order_number,16) WHERE project_key='LUUFI';
