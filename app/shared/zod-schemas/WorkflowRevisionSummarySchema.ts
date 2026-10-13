import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * One earlier version of a workflow: the workflow as it was just before a
 * write replaced it. `source` names that write — `canvas`, `agent:<name>`,
 * `cloud`, `import` or `restore`. No content: read one with
 * `workflows.getRevision`.
 */
export const WorkflowRevisionSummarySchema = z
  .object({
    revisionId: z.string().min(1),
    workflowId: z.string().min(1),
    source: z.string().regex(/^(canvas|cloud|import|restore|agent:.+)$/),
    /** The workflow's `rev` this version was. */
    workflowRev: RevisionSchema,
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
  })
  .strict()
