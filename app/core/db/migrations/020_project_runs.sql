-- One row per project run: a project's enabled workflows run in order against
-- one environment. Each workflow's run is an ordinary `runs` row; `items_json`
-- lists them in order with each one's outcome, so the record survives its
-- child runs being pruned from a workflow's history.
--
-- No workspace column: a project run belongs to its project, and a project
-- that moves to another workspace takes its run history with it.
CREATE TABLE project_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  environment_id TEXT,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  startedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finishedAt TEXT,
  FOREIGN KEY (project_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL
);

-- Newest-first history per project, and the retention prune after each finish.
CREATE INDEX idx_project_runs_project_started ON project_runs(project_id, startedAt, id);
