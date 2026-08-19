-- What an agent session was, after the process that was it is gone.
--
-- A session row currently records only APIWeave's side of a launch: a pid, an
-- exit code, a folder. That is enough to list what has run and nothing else —
-- reopening a finished row offers its scrollback, and once the PTY host has
-- gone (a quit, a crash, the next app start) even that is gone, leaving a row
-- that can only say "this session's output is no longer available".
--
-- The agents themselves have the missing half. Every CLI in the roster that
-- supports resuming keeps its own conversation under its own session id, and
-- will reopen it on request — `claude --resume <uuid>`, `opencode --session
-- <ses_...>`. Storing that id is what turns a dead row from a receipt into
-- something the user can pick back up, and it is exactly one string.
--
-- Two columns rather than one because they come from different places and are
-- true at different times:
--
--   agent_session_ref — the CLI's own identifier for the conversation. Known
--     up front for agents that let APIWeave assign it (`--session-id <uuid>`),
--     and only observed later for agents that mint their own and print it.
--     Deliberately not UNIQUE: resuming continues the *same* conversation, so
--     the new row shares the ref with the one it resumed from. That is the
--     relationship, and a constraint forbidding it would forbid the feature.
--
--   title — what the agent called the work, taken from the terminal title it
--     sets. Null until the agent sets one, and for CLIs that never do.
--
-- Both nullable with no default: a row written before this migration has no
-- honest value for either, and NULL is the answer that says so. `ALTER TABLE
-- ADD COLUMN` is also the only form SQLite performs without rewriting the
-- table, which matters for a table users already have rows in.
ALTER TABLE agent_sessions ADD COLUMN agent_session_ref TEXT;
ALTER TABLE agent_sessions ADD COLUMN title TEXT;

-- Resume looks a session up by the agent it belongs to and by the folder it ran
-- in, never by ref alone: an id is only meaningful to the CLI that issued it,
-- and two agents are free to mint the same string.
CREATE INDEX idx_agent_sessions_ref ON agent_sessions(workspace_id, agent_key, agent_session_ref);
