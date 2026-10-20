-- The commit a workspace's clone was on before a fast-forward or a discard
-- moved it to the remote's tip, set until the import of that tip commits (and
-- cleared in the import's own transaction). Set at startup, it means the clone
-- moved but the database did not: the clone goes back to this commit before
-- anything is serialized over it, or the next commit would push a revert of
-- the remote's change.
ALTER TABLE workspace_git ADD COLUMN integrating_from TEXT;
