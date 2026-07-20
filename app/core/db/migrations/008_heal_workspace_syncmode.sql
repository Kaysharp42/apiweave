-- Heal workspaces left with syncMode='local-only' by the old unlink path.
-- 'local-only' is not a valid WorkspaceSyncMode (none|push|bi-directional),
-- so it fails WorkspaceSyncModeSchema on read and breaks the workspace
-- listing over IPC. Unlink now restores local workspaces to 'none' (the
-- default for a fresh local workspace); rewrite any lingering 'local-only'
-- rows to match. No-op on clean databases and idempotent on re-run.

UPDATE workspaces SET syncMode = 'none' WHERE syncMode = 'local-only';
