import { z } from "zod"
import { LoadNodeStatsSchema } from "./LoadNodeStatsSchema"
import { LoadRunSettingsSchema } from "./LoadRunSettingsSchema"
import { RunResultSchema } from "./RunResultSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * One load run's retained record: its settings, the per-node aggregate
 * statistics and the first failure per node. This — not every iteration's full
 * response — is what a load run keeps, so a run of thousands of iterations
 * stays bounded.
 */
export const LoadRunSchema = z
  .object({
    loadRunId: z.string().min(1),
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    status: z.enum(["completed", "failed", "cancelled", "interrupted"]),
    startedAt: TimestampSchema.nullable(),
    completedAt: TimestampSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    /** Iterations that actually ran (fewer than planned when a duration cap cut it short). */
    iterationCount: z.number().int().nonnegative(),
    settings: LoadRunSettingsSchema,
    /** One entry per node that ran, in first-execution order. */
    nodeStats: z.array(LoadNodeStatsSchema),
    /** The first failed result per node, keyed by node id; masked like run history. */
    firstFailures: z.record(z.string(), RunResultSchema),
    /** Threshold expressions that were breached, in the order given. */
    breachedThresholds: z.array(z.string().min(1)),
  })
  .strict()
