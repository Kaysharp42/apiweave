-- Remember which cloud account a workspace was last bound to.
--
-- cloud_workspace_bindings is wiped on Disconnect, so it cannot answer "who
-- owned this workspace?" after the account is gone. Without that answer the
-- reconciler re-pairs a kept local workspace (notably Personal, which matches
-- on the isPersonal flag alone) with the NEXT account that links, and pushes
-- the previous account's workflows into it.
--
-- This table outlives Disconnect and is never synced. Rows cascade away with
-- their workspace, so a removed workspace leaves no stamp behind.

CREATE TABLE cloud_workspace_accounts (
  workspace_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  stampedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_cloud_workspace_accounts_account
  ON cloud_workspace_accounts (account_id);

-- Backfill: anything bound right now belongs to the account linked right now.
-- Databases with no linked account (or no bindings) get nothing, which leaves
-- their workspaces unstamped — i.e. claimable by the first account to link,
-- which is the correct reading of "never synced with anyone".
INSERT OR IGNORE INTO cloud_workspace_accounts (workspace_id, account_id)
SELECT bindings.workspace_id, json_extract(settings.value, '$.accountId')
FROM cloud_workspace_bindings AS bindings
JOIN app_settings AS settings ON settings.key = 'cloud.account_identity'
WHERE json_extract(settings.value, '$.accountId') IS NOT NULL;
