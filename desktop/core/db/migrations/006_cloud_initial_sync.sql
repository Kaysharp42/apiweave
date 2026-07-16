ALTER TABLE cloud_workspace_bindings ADD COLUMN cloud_workspace_name TEXT NOT NULL DEFAULT '';
ALTER TABLE cloud_workspace_bindings ADD COLUMN team_name TEXT;
ALTER TABLE cloud_workspace_bindings ADD COLUMN initialization_state TEXT NOT NULL DEFAULT 'initialized'
  CHECK (initialization_state IN ('pulling', 'pushing', 'initialized'));
ALTER TABLE cloud_workspace_bindings ADD COLUMN initializedAt TEXT;
ALTER TABLE cloud_workspace_bindings ADD COLUMN last_error TEXT;

ALTER TABLE cloud_outbox ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0
  CHECK (is_baseline IN (0, 1));

INSERT OR REPLACE INTO app_settings (key, value)
SELECT 'cloud.binding_migration_warning', printf('%d duplicate cloud workspace binding(s) were disconnected', COUNT(*))
FROM (
  SELECT workspace_id,
         ROW_NUMBER() OVER (PARTITION BY cloud_workspace_id ORDER BY boundAt, workspace_id) AS binding_rank
  FROM cloud_workspace_bindings
)
WHERE binding_rank > 1
HAVING COUNT(*) > 0;

WITH ranked_bindings AS (
  SELECT workspace_id,
         ROW_NUMBER() OVER (PARTITION BY cloud_workspace_id ORDER BY boundAt, workspace_id) AS binding_rank
  FROM cloud_workspace_bindings
)
UPDATE workspaces
SET origin = 'local', syncMode = 'none'
WHERE id IN (SELECT workspace_id FROM ranked_bindings WHERE binding_rank > 1);

WITH ranked_bindings AS (
  SELECT workspace_id,
         ROW_NUMBER() OVER (PARTITION BY cloud_workspace_id ORDER BY boundAt, workspace_id) AS binding_rank
  FROM cloud_workspace_bindings
)
DELETE FROM cloud_workspace_bindings
WHERE workspace_id IN (SELECT workspace_id FROM ranked_bindings WHERE binding_rank > 1);

CREATE UNIQUE INDEX idx_cloud_workspace_bindings_cloud_workspace
  ON cloud_workspace_bindings (cloud_workspace_id);

CREATE UNIQUE INDEX idx_cloud_outbox_baseline_record
  ON cloud_outbox (workspace_id, kind, record_id)
  WHERE is_baseline = 1;
