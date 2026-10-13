import type { z } from "zod"
import type { WorkflowRevisionSummarySchema } from "../zod-schemas/WorkflowRevisionSummarySchema"

export type WorkflowRevisionSummary = z.infer<typeof WorkflowRevisionSummarySchema>
