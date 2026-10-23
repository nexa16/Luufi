ALTER TABLE planning_projects ADD COLUMN versions_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE planning_projects SET next_order_number=MAX(next_order_number,19) WHERE project_key='LUUFI';
--> statement-breakpoint
CREATE TABLE project_versions (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES planning_projects(id),
 label TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('develop','production')),
 title TEXT NOT NULL, changelog TEXT NOT NULL, repository_commit TEXT NOT NULL, source_branch TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, release_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(project_id,label,channel)
);
--> statement-breakpoint
CREATE TABLE version_orders (
 id TEXT PRIMARY KEY NOT NULL, version_id TEXT NOT NULL REFERENCES project_versions(id),
 order_id TEXT NOT NULL REFERENCES planning_orders(id), display_id TEXT NOT NULL, title TEXT NOT NULL,
 spec_version INTEGER NOT NULL, implementation_id TEXT, integration_id TEXT,
 implementation_commit TEXT NOT NULL, integration_reference TEXT NOT NULL,
 provenance_kind TEXT NOT NULL CHECK(provenance_kind IN ('execution','bootstrap')),
 UNIQUE(version_id,order_id)
);
--> statement-breakpoint
CREATE TABLE version_builds (
 id TEXT PRIMARY KEY NOT NULL, version_id TEXT NOT NULL REFERENCES project_versions(id),
 kind TEXT NOT NULL CHECK(kind IN ('site','apk')), environment TEXT NOT NULL CHECK(environment IN ('preview','production')),
 outcome TEXT NOT NULL CHECK(outcome IN ('available','unavailable','failure')),
 payload_json TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX version_builds_version ON version_builds(version_id,observed_at,id);
--> statement-breakpoint
CREATE TABLE version_releases (
 id TEXT PRIMARY KEY NOT NULL, version_id TEXT NOT NULL UNIQUE REFERENCES project_versions(id),
 project_id TEXT NOT NULL REFERENCES planning_projects(id), tag TEXT NOT NULL, payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(project_id,tag)
);
--> statement-breakpoint
CREATE TABLE bootstrap_provenance (
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES planning_orders(id), number INTEGER NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('sites-proof','public-git')),
 implementation_commit TEXT, integration_commit TEXT, pr_url TEXT, ci_url TEXT,
 source_commit TEXT NOT NULL, verification_reference TEXT NOT NULL, verified_at TEXT NOT NULL,
 manifest_version TEXT NOT NULL, created_at TEXT NOT NULL
);
