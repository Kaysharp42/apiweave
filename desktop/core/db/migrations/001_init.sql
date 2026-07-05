CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL DEFAULT 'local',
  syncMode TEXT NOT NULL DEFAULT 'none',
  settings_json TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  graph_json TEXT NOT NULL DEFAULT '{}',
  variables_json TEXT NOT NULL DEFAULT '{}',
  settings_json TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  status TEXT NOT NULL,
  node_statuses_json TEXT NOT NULL DEFAULT '{}',
  extracted_variables_json TEXT NOT NULL DEFAULT '{}',
  response_metadata_json TEXT NOT NULL DEFAULT '{}',
  response_body_inline BLOB,
  response_body_size INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  startedAt TEXT,
  completedAt TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE TABLE run_responses (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  body BLOB NOT NULL,
  size INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (run_id, node_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '{}',
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  workflow_ids_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE scoped_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  public_key BLOB NOT NULL,
  encrypted_private_key BLOB NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE secrets_metadata (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  scopeType TEXT NOT NULL DEFAULT 'workspace',
  scopeId TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
CREATE INDEX idx_workflows_scope ON workflows(scopeType, scopeId);
CREATE INDEX idx_runs_workflow ON runs(workflow_id, status);
CREATE INDEX idx_runs_scope ON runs(scopeType, scopeId);
CREATE INDEX idx_environments_scope ON environments(scopeType, scopeId);
CREATE INDEX idx_collections_scope ON collections(scopeType, scopeId);
CREATE INDEX idx_scoped_keys_scope ON scoped_keys(scopeType, scopeId);
CREATE INDEX idx_secrets_metadata_scope ON secrets_metadata(scopeType, scopeId);

CREATE TRIGGER workspaces_touch AFTER UPDATE ON workspaces
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE workspaces SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER workflows_touch AFTER UPDATE ON workflows
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE workflows SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER runs_touch AFTER UPDATE ON runs
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE runs SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER environments_touch AFTER UPDATE ON environments
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE environments SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER collections_touch AFTER UPDATE ON collections
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE collections SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER scoped_keys_touch AFTER UPDATE ON scoped_keys
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE scoped_keys SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

CREATE TRIGGER secrets_metadata_touch AFTER UPDATE ON secrets_metadata
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE secrets_metadata SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;
