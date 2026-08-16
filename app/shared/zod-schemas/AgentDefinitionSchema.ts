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
