-- A merge waiting for the user: both sides changed since the commits below last
-- agreed, and APIWeave could not settle every field by itself. The three
-- commits are what recomputes the merge — the same trees and picks give the
-- same conflicts — so a restart needs nothing else from the clone. A new merge
-- replaces the row (and, by cascade, its picks).
CREATE TABLE workspace_merge (
  workspace_id TEXT PRIMARY KEY,
  base_commit TEXT NOT NULL,
  our_commit TEXT NOT NULL,
  their_commit TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspace_git(workspace_id) ON DELETE CASCADE
);

-- The user's decisions: which copy settles one conflict, named as a merge
-- pick is (recordId, path, side). base_commit is the merge they were made
-- against; picks recorded for a base commit that is no longer the merge's are
-- ignored rather than applied to a different conflict.
CREATE TABLE workspace_merge_pick (
  workspace_id TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  record_id TEXT NOT NULL,
  path TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('ours', 'theirs')),
  PRIMARY KEY (workspace_id, record_id, path),
  FOREIGN KEY (workspace_id) REFERENCES workspace_merge(workspace_id) ON DELETE CASCADE
);
