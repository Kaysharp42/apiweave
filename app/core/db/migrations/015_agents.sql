-- Coding-agent support: where a project lives on THIS machine, which agent
-- CLIs the user has configured, and which sessions have been launched.
--
-- `agent_local_paths` is deliberately its own table rather than a `localPath`
-- column on `collections`. Cloud sync pushes an explicit field allowlist
-- (`core/sync/cloud-mutations.ts`), so a column there would technically stay
-- local — but only for as long as nobody adds it to that list, and an absolute
-- Windows path arriving on someone's Mac is a silent, confusing failure. A
-- separate table has no sync path to add it to, and keeps `.awecollection`
-- export bundles free of machine paths by construction.
--
-- The scope is polymorphic (`project` = a collection row, `workflow` = a
-- workflow row) so there is no FK to cascade on. Rows are only ever read by
-- explicit id, so an orphan left behind by a deleted project is unreachable
-- rather than wrong; `AgentRepository.deleteLocalPath` cleans up on demand.
CREATE TABLE agent_local_paths (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'workflow')),
  scope_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scope_kind, scope_id)
);

-- A user-defined agent beyond the built-in roster, plus per-agent overrides
-- (extra args, extra env) for built-ins.
--
-- `argv_json` is an argv ARRAY, never a command string: a string has to be
-- split by a shell to be run, and `shell: true` is both an injection vector
-- and — measured on Node v24 — silently lossy, dropping everything after the
-- first space in an argument. `agent_key` is the stable identifier the
-- renderer sends; for a built-in override it matches the registry key.
--
-- The columns are the fields a launch needs to read directly. Everything that
-- only describes *behaviour* — prompt injection mode, MCP flag support,
-- unsupported platforms — lives in `options_json`, following `node_presets`'
-- `config_json`: those fields grow with each phase, and none of them is ever
-- queried on, so a column each would be a migration each for no lookup.
CREATE TABLE agent_definitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  name TEXT NOT NULL,
  detect_cmd TEXT NOT NULL,
  argv_json TEXT NOT NULL DEFAULT '[]',
  expected_process TEXT,
  env_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '{}',
  is_custom INTEGER NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_agent_definitions_key ON agent_definitions(workspace_id, agent_key);

CREATE TRIGGER agent_definitions_touch AFTER UPDATE ON agent_definitions
FOR EACH ROW WHEN NEW.rev = OLD.rev AND NEW.updatedAt = OLD.updatedAt
BEGIN
  UPDATE agent_definitions SET rev = OLD.rev + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', julianday('now') + ((OLD.rev + 1) / 86400000.0)) WHERE id = NEW.id;
END;

-- One launched agent session. Written for both launch modes: an external
-- terminal (Phase 2) records the launch and then nothing more, an embedded PTY
-- (Phase 3) also carries a pid and a live status. `cwd` is stored resolved so
-- the session list stays readable after the project path is changed.
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  launch_mode TEXT NOT NULL CHECK (launch_mode IN ('external', 'embedded')),
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'exited', 'failed')),
  cwd TEXT NOT NULL,
  scope_kind TEXT CHECK (scope_kind IN ('project', 'workflow')),
  scope_id TEXT,
  pid INTEGER,
  exit_code INTEGER,
  error TEXT,
  startedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  endedAt TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_sessions_workspace ON agent_sessions(workspace_id, startedAt DESC);
