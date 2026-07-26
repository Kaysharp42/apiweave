-- Cloud-side writer attribution for conflicts. The desktop already knows its
-- own (local) writer — it is this device's user. Only the cloud writer, which
-- the server carries on the push-conflict outcome (PushOutcome.cloud_writer),
-- needs storing so the conflict UI can show who wrote the cloud copy.
-- All columns are nullable: pre-existing rows and pull-created conflicts (no
-- server writer) render as "unknown author".
ALTER TABLE cloud_conflicts ADD COLUMN cloud_writer_user_id TEXT;
ALTER TABLE cloud_conflicts ADD COLUMN cloud_writer_device_id TEXT;
ALTER TABLE cloud_conflicts ADD COLUMN cloud_writer_name TEXT;
ALTER TABLE cloud_conflicts ADD COLUMN cloud_writer_device_label TEXT;
