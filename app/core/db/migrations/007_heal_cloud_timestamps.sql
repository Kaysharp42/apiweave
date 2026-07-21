-- Heal timestamps corrupted by the cloud-sync apply path, which wrote
-- updatedAt via SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", no T/Z)
-- instead of the canonical strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ISO form.
-- Those values fail TimestampSchema (z.iso.datetime()) on read, breaking
-- the workspace/workflow/collection/environment listings. Rewrite any
-- non-ISO updatedAt (the space-separated form) back to ISO-8601 UTC.
-- Rows already in ISO form (containing 'T') are left untouched, so this is
-- a no-op on clean databases and idempotent on re-run.

UPDATE workspaces   SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt)
  WHERE updatedAt NOT LIKE '%T%' AND strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt) IS NOT NULL;
UPDATE workflows    SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt)
  WHERE updatedAt NOT LIKE '%T%' AND strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt) IS NOT NULL;
UPDATE collections  SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt)
  WHERE updatedAt NOT LIKE '%T%' AND strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt) IS NOT NULL;
UPDATE environments SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt)
  WHERE updatedAt NOT LIKE '%T%' AND strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt) IS NOT NULL;
