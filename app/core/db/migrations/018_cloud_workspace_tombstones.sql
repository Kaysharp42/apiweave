-- The cloud tombstone of a deleted workspace, kept out of cloud_outbox.
--
-- cloud_outbox rows cascade away with their workspace, and deleting the
-- workspace is the very thing a workspace tombstone records — so the tombstone
-- was deleted by the statement that made it necessary and never reached the
-- server. This table has no foreign key: a row outlives the local workspace and
-- carries the cloud workspace id itself, because the binding that held it
-- cascades away too.
CREATE TABLE cloud_workspace_tombstones (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  cloud_workspace_id TEXT NOT NULL,
  expected_rev INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
