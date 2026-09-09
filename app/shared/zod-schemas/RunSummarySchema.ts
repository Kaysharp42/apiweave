import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * One compact run-history row: identity, status, timing, failure counts and
 * revision. No per-node results, statuses, bodies or variables — history rows
 * stay constant-sized no matter how large the workflow is.
 */
export const RunSummarySchema = z
  .object({
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    trigger: z.enum(["manual", "schedule"]),
    startedAt: TimestampSchema.nullable().optional(),
    completedAt: TimestampSchema.nullable().optional(),
    duration: z.number().int().nonnegative().nullable().optional(),
    failedNodes: z.array(z.string().min(1)),
    failedNodeCount: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    runRev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
