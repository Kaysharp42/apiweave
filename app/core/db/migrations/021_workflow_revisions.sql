-- Earlier versions of a workflow, so a bad auto-save or agent edit can be
-- undone. A row is the workflow as it was just BEFORE a write replaced it,
-- captured by the write itself (see WorkflowRevisionRepository): at most one
-- per few minutes of canvas editing, and always before any other writer.
-- `snapshot` is gzipped JSON of the workflow's content (name, description,
-- nodes, edges, variables, tags, node templates) — the same references-only
-- config the workflow row holds, never a secret value. Local only: revisions
-- are never synced, and go with their workflow.
CREATE TABLE workflow_revisions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  -- Who made the write this snapshot preceded: canvas, agent:<name>, cloud, import, restore.
  source TEXT NOT NULL,
  -- The workflow's own revision the snapshot was taken at.
  workflow_rev INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  snapshot BLOB NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

-- Newest-first listing per workflow, and the retention prune after each capture.
CREATE INDEX idx_workflow_revisions_workflow ON workflow_revisions(workflow_id, createdAt);
