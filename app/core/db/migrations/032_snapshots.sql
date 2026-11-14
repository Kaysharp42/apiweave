-- Snapshot baselines for the `matchesSnapshot` assertion operator, one row per
-- assertion rule. Stored here rather than in the workflow so a re-record is one
-- row write instead of a workflow revision, and so the baseline can be shown,
-- diffed and accepted without touching the graph.
CREATE TABLE snapshots (
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  rule_index INTEGER NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, node_id, rule_index)
);
