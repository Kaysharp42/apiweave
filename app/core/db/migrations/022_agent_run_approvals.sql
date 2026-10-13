-- "Never ask again" answers from the agent-run approval dialog: the exact
-- (agent, workflow, secrets, destinations, scripts) shape the user allowed
-- for good. A run whose fingerprint no longer matches asks again. Revocable
-- from Settings > MCP Server.
CREATE TABLE agent_run_approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  secret_names TEXT NOT NULL,
  destinations TEXT NOT NULL,
  runs_scripts INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_agent_run_approvals_key
  ON agent_run_approvals(workspace_id, agent, workflow_id, fingerprint);
