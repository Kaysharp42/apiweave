-- A pick can settle a conflict with a value of the user's own instead of one
-- copy's, so a pick row carries one or the other: side, or value as JSON.
--
-- SQLite cannot drop `side`'s NOT NULL or its CHECK in place, and this table
-- holds the user's decisions, so the column is replaced without a table
-- rebuild, the way 028 replaced base_commit: a nullable column takes its name
-- and values, and the old one goes. The repository reads a row and refuses one
-- that carries both or neither, as it already checks workspace_git.state.
ALTER TABLE workspace_merge_pick ADD COLUMN value TEXT;
ALTER TABLE workspace_merge_pick RENAME COLUMN side TO side_required;
ALTER TABLE workspace_merge_pick ADD COLUMN side TEXT;
UPDATE workspace_merge_pick SET side = side_required;
ALTER TABLE workspace_merge_pick DROP COLUMN side_required;
