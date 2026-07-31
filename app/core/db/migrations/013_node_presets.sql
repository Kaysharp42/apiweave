-- Shared node-preset library (FEATURE-IDEAS §6.2). A preset is a named,
-- workspace-scoped, persisted node config — the durable counterpart to the
-- sessionStorage-only canvas clipboard and the in-memory Swagger palette
-- groups, both of which vanish on restart.
--
-- Deliberately WITHOUT the `scopeType`/`scopeId`/`slug` columns the sibling
-- tables carry: those exist for the environment/secret `workspace | user`
-- scope seam and for future slug routing, neither of which applies to a
-- preset. `workspace_id` alone is the scope.
CREATE TABLE node_presets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_node_presets_workspace ON node_presets(workspace_id);

CREATE TRIGGER node_presets_touch AFTER UPDATE ON node_presets
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE node_presets SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;
