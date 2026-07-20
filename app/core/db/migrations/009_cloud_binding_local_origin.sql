-- Remember whether a bound workspace existed locally or was downloaded from
-- Cloud. Disconnect uses this to remove downloaded copies without deleting
-- workspaces authored on this device.

ALTER TABLE cloud_workspace_bindings
  ADD COLUMN local_origin TEXT NOT NULL DEFAULT 'local'
  CHECK (local_origin IN ('local', 'cloud', 'team'));

-- Existing Team bindings were necessarily downloaded by the automatic
-- reconciler. Other legacy bindings remain conservative: treating them as
-- local avoids destructive cleanup when their original origin is unknowable.
UPDATE cloud_workspace_bindings
SET local_origin = 'team'
WHERE team_id IS NOT NULL;
