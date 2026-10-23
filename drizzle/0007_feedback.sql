-- Reserve the explicitly approved wave4 bootstrap IDs without reusing numbers.
UPDATE planning_projects SET next_order_number=MAX(next_order_number,13) WHERE project_key='LUUFI';
--> statement-breakpoint
CREATE TABLE feedback_threads (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES planning_projects(id),
  revision INTEGER NOT NULL DEFAULT 0,
  content_revision INTEGER NOT NULL DEFAULT 0,
  refined_content_revision INTEGER,
  next_entry_position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX feedback_threads_project ON feedback_threads(project_id,updated_at,id);
--> statement-breakpoint
CREATE TABLE feedback_entries (
  id TEXT PRIMARY KEY NOT NULL,
  feedback_id TEXT NOT NULL REFERENCES feedback_threads(id),
  kind TEXT NOT NULL CHECK(kind IN ('original','addition')),
  text TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(feedback_id,position)
);
--> statement-breakpoint
CREATE UNIQUE INDEX feedback_one_original ON feedback_entries(feedback_id) WHERE kind='original';
--> statement-breakpoint
CREATE TABLE feedback_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES planning_projects(id),
  feedback_id TEXT NOT NULL REFERENCES feedback_threads(id),
  entry_id TEXT NOT NULL REFERENCES feedback_entries(id),
  filename TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  declared_size INTEGER NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','expired')),
  revision INTEGER NOT NULL DEFAULT 0,
  object_key TEXT UNIQUE,
  actual_mime_type TEXT,
  actual_size INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  CHECK(status!='ready' OR (object_key IS NOT NULL AND actual_mime_type IS NOT NULL AND actual_size IS NOT NULL AND sha256 IS NOT NULL AND ready_at IS NOT NULL)),
  UNIQUE(entry_id,position)
);
--> statement-breakpoint
CREATE INDEX feedback_attachments_entry ON feedback_attachments(entry_id,id);
--> statement-breakpoint
CREATE INDEX feedback_attachments_cleanup ON feedback_attachments(status,created_at,id);
--> statement-breakpoint
CREATE TABLE feedback_refinements (
  id TEXT PRIMARY KEY NOT NULL,
  feedback_id TEXT NOT NULL REFERENCES feedback_threads(id),
  input_content_revision INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX feedback_refinements_thread ON feedback_refinements(feedback_id,created_at,id);
--> statement-breakpoint
CREATE TABLE feedback_order_sources (
  refinement_id TEXT NOT NULL REFERENCES feedback_refinements(id),
  feedback_id TEXT NOT NULL REFERENCES feedback_threads(id),
  order_id TEXT NOT NULL REFERENCES planning_orders(id),
  PRIMARY KEY(refinement_id,order_id)
);
