CREATE TABLE cloud_devices (
  device_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  client_version TEXT NOT NULL,
  public_key BLOB,
  access_token TEXT,
  encrypted_refresh_token TEXT,
  wrapped_dek TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revokedAt TEXT
);

CREATE TABLE cloud_workspace_bindings (
  workspace_id TEXT PRIMARY KEY,
  cloud_workspace_id TEXT NOT NULL,
  team_id TEXT,
  sync_mode TEXT NOT NULL,
  device_id TEXT,
  boundAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lastSyncedAt TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES cloud_devices(device_id) ON DELETE SET NULL
);

CREATE TABLE cloud_record_state (
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project', 'workflow', 'environment')),
  record_id TEXT NOT NULL,
  server_rev INTEGER NOT NULL DEFAULT 0,
  local_rev INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
  conflict_id TEXT,
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, kind, record_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE cloud_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project', 'workflow', 'environment')),
  record_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  expected_rev INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'tombstone')),
  payload BLOB,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_cloud_outbox_retry ON cloud_outbox (next_retry_at, created_at);

CREATE TABLE cloud_conflicts (
  conflict_id TEXT PRIMARY KEY,
  server_conflict_id TEXT,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'project', 'workflow', 'environment')),
  record_id TEXT NOT NULL,
  base_rev INTEGER NOT NULL,
  local_payload BLOB,
  cloud_payload BLOB,
  local_rev INTEGER NOT NULL,
  cloud_rev INTEGER NOT NULL,
  local_op TEXT NOT NULL CHECK (local_op IN ('upsert', 'tombstone')),
  cloud_op TEXT NOT NULL CHECK (cloud_op IN ('upsert', 'tombstone')),
  winner TEXT CHECK (winner IN ('local', 'cloud')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolvedAt TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_cloud_conflicts_workspace ON cloud_conflicts (workspace_id, status, createdAt);
CREATE UNIQUE INDEX idx_cloud_conflicts_pending_record
  ON cloud_conflicts (workspace_id, kind, record_id)
  WHERE status = 'pending';
