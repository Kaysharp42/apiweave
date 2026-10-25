-- Whether the workspace's latest merge with its remote had no common ancestor:
-- one workspace whose tracking was stopped and started again, or a clone
-- recreated from the database, whose copies nonetheless merge two ways.
--
-- The merge row that said so goes when the merge is abandoned, but the
-- divergence it leaves must still say the copies share no history rather than
-- that both changed since they agreed. Written when a merge starts (a null base
-- commit is a two-way merge) and cleared with the remote.
ALTER TABLE workspace_git ADD COLUMN unrelated_merge INTEGER NOT NULL DEFAULT 0 CHECK (unrelated_merge IN (0, 1));
