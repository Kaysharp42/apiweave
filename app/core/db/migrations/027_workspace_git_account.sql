-- The git account a workspace syncs as: one of the accounts gh or glab is
-- signed in to, named by provider, host and login. Its fetches, pushes and
-- clone ask that tool for the account's token, one call at a time; no token is
-- ever stored here. All three NULL: no account is bound, and the user's own
-- credential helpers and SSH keys apply, as they always have.
--
-- Machine-local, like the rest of the row: never written to the workspace's
-- repository, never exported, never read by an MCP tool. provider is checked
-- by the repository rather than here, as state is, so a provider added later
-- needs no table rebuild.
ALTER TABLE workspace_git ADD COLUMN account_provider TEXT;
ALTER TABLE workspace_git ADD COLUMN account_host TEXT;
ALTER TABLE workspace_git ADD COLUMN account_login TEXT;
