-- Secrets are write-only: the sealed ciphertext is persisted verbatim and never
-- read back through a metadata path. 001 shipped secrets_metadata without a home
-- for the sealed bytes or the sealing key id; add them so the SecretRepository
-- can store what SecretUpsert carries. Nullable/defaulted so existing rows are valid.
ALTER TABLE secrets_metadata ADD COLUMN sealed BLOB;
ALTER TABLE secrets_metadata ADD COLUMN key_id TEXT NOT NULL DEFAULT '';
