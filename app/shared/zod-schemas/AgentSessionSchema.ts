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
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.nullable().optional(),
  })
  .strict()
