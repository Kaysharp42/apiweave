import { z } from "zod"
import { NodeEvidenceSchema } from "./NodeEvidenceSchema"
import { RunArtifactSchema } from "./RunArtifactSchema"

/**
 * Bounded multi-node evidence result. `missingNodeIds` names requested ids
 * with no stored result; `budgetBytes`/`budgetLimitBytes` state the inline
 * budget this page was held to.
 */
export const NodeEvidencePageSchema = z
  .object({
    runId: z.string().min(1),
    workflowId: z.string().min(1),
    runStatus: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    items: z.array(NodeEvidenceSchema),
    missingNodeIds: z.array(z.string().min(1)),
    omittedBodyCount: z.number().int().nonnegative(),
    budgetBytes: z.number().int().nonnegative(),
    budgetLimitBytes: z.number().int().positive(),
    /** A failed browser step's screenshot, when asked for. Agents receive it as image content, outside the text budget. */
    screenshot: RunArtifactSchema.optional(),
  })
  .strict()
