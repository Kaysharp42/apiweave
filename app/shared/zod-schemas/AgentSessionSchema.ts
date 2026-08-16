import { z } from "zod"
import { TimestampSchema } from "./TimestampSchema"

/**
 * `external` opens the user's terminal emulator and forgets about it — there is
 * no pid to watch once the terminal has forked. `embedded` runs under a PTY
 * APIWeave owns, so it carries a live pid, an exit code, and output events.
 */
export const AgentLaunchModeSchema = z.enum(["external", "embedded"])

export const AgentSessionStatusSchema = z.enum(["starting", "running", "exited", "failed"])

export const AgentSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    workspaceId: z.string().min(1),
    agentKey: z.string().min(1),
    launchMode: AgentLaunchModeSchema,
    status: AgentSessionStatusSchema,
    /** Resolved at launch and stored, so the list stays readable after the project path changes. */
    cwd: z.string().min(1),
    scopeKind: z.enum(["project", "workflow"]).nullable().optional(),
    scopeId: z.string().nullable().optional(),
    pid: z.number().int().nullable().optional(),
    exitCode: z.number().int().nullable().optional(),
    error: z.string().nullable().optional(),
    /**
     * The agent CLI's *own* identifier for the conversation — `claude`'s session
     * UUID, `opencode`'s `ses_…`. Not APIWeave's `sessionId`, which names the
     * row and means nothing to the agent.
     *
     * Its presence is what makes a finished session resumable, and the UI reads
     * it that way: a ref is only ever stored for an agent whose definition
     * declares how to resume one, so `agentSessionRef !== null` is the whole
     * test. Null for agents that cannot resume, and for sessions launched before
     * this was recorded.
     */
    agentSessionRef: z.string().nullable().optional(),
    /**
     * What the agent called the work, harvested from the terminal title it sets.
     * Null until it sets one — the row falls back to the agent's name.
     */
    title: z.string().nullable().optional(),
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable().optional(),
  })
  .strict()
