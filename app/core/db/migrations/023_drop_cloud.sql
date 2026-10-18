-- Remove the schema Cloud sync owned. The code that read and wrote it is gone,
-- so these tables, the two workspace columns and the cloud.* settings are
-- written by nothing and read by nothing.
--
-- cloud_devices goes last: cloud_workspace_bindings.device_id references it,
-- and dropping a parent first would run ON DELETE SET NULL into its child.
DROP TABLE cloud_workspace_bindings;
DROP TABLE cloud_record_state;
DROP TABLE cloud_outbox;
DROP TABLE cloud_conflicts;
DROP TABLE cloud_workspace_tombstones;
DROP TABLE cloud_workspace_accounts;
DROP TABLE cloud_devices;

-- Neither column is in an index, trigger, CHECK or UNIQUE constraint, so SQLite
-- drops them in place without rebuilding workspaces.
ALTER TABLE workspaces DROP COLUMN origin;
ALTER TABLE workspaces DROP COLUMN syncMode;

-- Account identity, tokens, catalogs, sync cursors and the safeStorage-sealed
-- workspace keys (cloud.e2ee.wdek.<id>) were all app_settings rows.
DELETE FROM app_settings WHERE key GLOB 'cloud.*';

-- Never read or written by any code since 001 created it. Its index and its
-- scoped_keys_touch trigger go with it.
DROP TABLE scoped_keys;
