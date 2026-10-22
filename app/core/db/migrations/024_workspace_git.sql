-- A workspace whose history APIWeave keeps in a git repository, cloned at
-- userData/git/<workspace_id>. No row: the workspace is not tracked.
--
-- remote_url is null while the history is local only. state is checked by the
-- repository rather than here: the sync cycle grows states as it grows, and
-- this table holds the user's binding, so changing a CHECK on it would mean the
-- table rebuild the content-table guard refuses.
CREATE TABLE workspace_git (
  workspace_id TEXT PRIMARY KEY,
  remote_url TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual')),
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  last_synced_commit TEXT,
  last_synced_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
