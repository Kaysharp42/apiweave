-- Evidence files a run produced, such as a failed `browser` step's screenshot.
-- Bodies live here rather than inline in a run result for the same reason large
-- response bodies live in `run_responses`: listing a run must never carry an
-- image. The foreign key drops an artifact with its run (both the app and the
-- CLI open the database with `foreign_keys = ON`).
CREATE TABLE run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  body BLOB NOT NULL,
  size INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_run_artifacts_run ON run_artifacts(run_id, node_id);
