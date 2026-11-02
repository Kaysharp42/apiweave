-- The workflow revision a run was created against, so a debug read can say
-- whether the graph on the canvas is the one that ran or a later edit.
-- NULL for runs recorded before this column existed: their revision is unknown.
ALTER TABLE runs ADD COLUMN workflow_rev INTEGER;
