// fallow-ignore-file code-duplication -- independent domain schemas that only share the idiomatic `z.object({...}).strict()` opening every zod schema has; the fields themselves belong to different domains and there is no shared behaviour to extract; fallow 2.104 has no range form, so file-level is the narrowest marker that still covers the groups
import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * How an agent is handed its opening prompt. Kept as a field rather than
 * derived, because it genuinely differs per agent and there is no rule that
 * predicts it — Phase 4 ("Debug this failure with an agent") is the consumer.
 *
 * - `none`   — no prompt support; launch bare.
 * - `argv`   — the prompt is a positional argument.
 * - `flag`   — the prompt follows a flag, named by `promptFlag`.
 * - `stdin`  — the prompt is typed into the PTY once the agent is up.
 */
export const AgentPromptModeSchema = z.enum(["none", "argv", "flag", "stdin"])

/**
 * How APIWeave comes to know the agent's own session identifier — the thing
 * `resumeArgs` needs, and the one piece of the resume story that is not the same
 * for two CLIs.
 *
 * - `assign` — APIWeave mints the id and hands it over at launch
 *   (`claude --session-id <uuid>`). Known before the process starts, so it
 *   survives a session that is killed before it ever prints anything.
 * - `scan`   — the agent mints its own and prints it; APIWeave reads it out of
 *   the output stream with {@link AgentDefinitionSchema.shape.sessionIdPattern}.
 *   `opencode` is this: it accepts `--session <id>` to continue one but has no
 *   flag to name one at launch, and prints `opencode -s ses_…` when it exits.
 * - `none`   — no resume support. The default, and the honest answer for every
 *   agent whose flags have not been confirmed against a real CLI.
 */
export const AgentSessionIdModeSchema = z.enum(["none", "assign", "scan"])

/**
 * A launchable agent CLI.
 *
 * `argv` is an array and never a command string. A string has to be split by a
 * shell to be run, and `shell: true` is both an injection vector and — measured
 * on Node v24 — silently lossy: it joins arguments with spaces instead of
 * quoting them, so `hello world` arrives as `hello`. Node emits DEP0190 for it.
 *
 * `detectCmd` is separate from `argv[0]` because you detect a binary but launch
 * a command line: `kiro-cli` is on PATH, but the thing to run is
 * `kiro-cli chat --tui`. `expectedProcess` is separate again because a shim
 * launches something differently named, and without it a live session cannot be
 * told from a dead one.
 */
export const AgentDefinitionSchema = z
  .object({
    /** Stable identifier the renderer sends instead of a command. */
    agentKey: z.string().min(1),
    name: z.string().min(1),
    detectCmd: z.string().min(1),
    argv: z.array(z.string()).default([]),
    expectedProcess: z.string().nullable().optional(),
    env: z.record(z.string(), z.string()).default({}),
    promptMode: AgentPromptModeSchema.default("none"),
    promptFlag: z.string().nullable().optional(),
    /**
     * The argv that points the agent at APIWeave's MCP config file, with
     * `{path}` standing in for the file's location. An empty array means the
     * agent launches without MCP wiring. One template rather than a boolean so
     * a user-added agent can name its own flags instead of being assumed to be
     * Claude: `--mcp-config {path}` is one CLI's contract, not every CLI's.
     * Only verified entries ship in the built-in roster — a wrong template
     * produces an agent that refuses to start with an unknown-flag error.
     */
    mcpConfigArgs: z.array(z.string()).default([]),
    /**
     * The argv that hands the agent APIWeave's session briefing — what the
     * session is attached to, and how to work on it — with `{path}` standing in
     * for the generated file. Empty means the agent is launched without one.
     *
     * A *system prompt* flag and not a prompt flag: `promptMode` carries the
     * question the user asked, which the agent answers and the user sees. This
     * carries context the user should never have to type and never has to read,
     * so it belongs wherever the CLI puts standing instructions. Very few CLIs
     * have such a flag; the rest learn the same things from the MCP server's own
     * `instructions`, which is why this being empty is not a hole.
     *
     * A path rather than the text inline, deliberately: on Windows a `.cmd` shim
     * is run through `cmd.exe /c`, where the briefing's own newlines and `&`
     * would be parsed as command syntax.
     */
    briefingArgs: z.array(z.string()).default([]),
    /** How the agent's own session id becomes known; see {@link AgentSessionIdModeSchema}. */
    sessionIdMode: AgentSessionIdModeSchema.default("none"),
    /**
     * The argv that names the session at launch, with `{id}` standing in for the
     * id APIWeave mints. Only read when `sessionIdMode` is `assign`.
     */
    newSessionArgs: z.array(z.string()).default([]),
    /**
     * The argv that reopens a stored session, with `{id}` standing in for its
     * `agentSessionRef`. An empty array means the agent cannot resume, whatever
     * `sessionIdMode` says — this is the field the UI's Resume affordance
     * ultimately rests on, so it stays empty until the flags are confirmed
     * against an installed CLI, exactly as `mcpConfigArgs` does.
     */
    resumeArgs: z.array(z.string()).default([]),
    /**
     * A regular expression, as source text, matching the agent's own session id
     * in its output. Only read when `sessionIdMode` is `scan`.
     *
     * Source text rather than a `RegExp` because a definition is persisted as
     * JSON and travels through IPC, and neither carries a compiled regex. The
     * PTY host compiles it, and treats a pattern it cannot compile as no pattern
     * at all — a user-supplied agent must not be able to take the host down with
     * a bad expression. Anchor it tightly: the first match wins, and a loose
     * pattern will happily capture an id the agent merely quoted.
     *
     * If the pattern defines a capture group, group 1 is taken as the id and the
     * rest of the match is context. That is what makes an agent whose id is a
     * bare UUID tractable — a naked UUID pattern would match the first one to
     * appear in the agent's own output, which is as likely to be from a file it
     * is reading as its own. Anchor on the words the CLI prints around it.
     */
    sessionIdPattern: z.string().nullable().optional(),
    /** Platforms the agent does not work on, so the roster can grey it out. */
    unsupportedPlatforms: z.array(z.string()).default([]),
    /** Documentation URL, shown when the agent is missing so it can be installed. */
    installUrl: z.string().nullable().optional(),
  })
  .strict()

/** A definition as persisted — a user's custom agent, or an override of a built-in. */
export const StoredAgentDefinitionSchema = AgentDefinitionSchema.extend({
  definitionId: z.string().min(1),
  workspaceId: z.string().min(1),
  isCustom: z.boolean().default(true),
  rev: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict()
