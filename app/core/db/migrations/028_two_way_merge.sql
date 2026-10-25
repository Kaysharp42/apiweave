-- A merge can now be between two copies of one workspace that share no commit:
-- an earlier history was replaced on the remote, or this device's repository
-- was recreated from the database. Nothing is a change from anything then, so
-- there is no ancestor to name: base_commit is NULL, and the merge is two ways.
--
-- SQLite cannot drop a NOT NULL in place and this table holds the user's
-- decisions, so no table is rebuilt: the column is renamed, a nullable one
-- takes its name and values, and the old one goes. A merge waiting through the
-- upgrade keeps its row and its picks.
ALTER TABLE workspace_merge RENAME COLUMN base_commit TO base_commit_not_null;
ALTER TABLE workspace_merge ADD COLUMN base_commit TEXT;
UPDATE workspace_merge SET base_commit = base_commit_not_null;
ALTER TABLE workspace_merge DROP COLUMN base_commit_not_null;

-- The picks name the merge they were made against. A two-way merge names none,
-- so the column is nullable here too, and read back with `IS ?` so NULL matches.
ALTER TABLE workspace_merge_pick RENAME COLUMN base_commit TO base_commit_not_null;
ALTER TABLE workspace_merge_pick ADD COLUMN base_commit TEXT;
UPDATE workspace_merge_pick SET base_commit = base_commit_not_null;
ALTER TABLE workspace_merge_pick DROP COLUMN base_commit_not_null;
