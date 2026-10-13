import { z } from "zod"

/**
 * One workflow of a project run, in run order. `status` is its run's status,
 * or `pending` before it starts and `skipped` when it never ran (an earlier
 * workflow stopped the project, or the project run was cancelled first).
 */
export const ProjectRunItemSchema = z
  .object({
    workflowId: z.string().min(1),
    /** The workflow's name when the project run started. */
    workflowName: z.string(),
    /** From the project's order: go on to the next workflow if this one fails. */
    continueOnFail: z.boolean(),
    /** The workflow's own run, once it was enqueued. Open it in that workflow's History. */
    runId: z.string().min(1).nullable(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted", "skipped"]),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict()
