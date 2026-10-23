ALTER TABLE project_ideas ADD revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE idea_mutation_requests (
  request_key TEXT PRIMARY KEY NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);
