import type { z } from "zod"
import type { WorkflowSummarySchema } from "../zod-schemas/WorkflowSummarySchema"

export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>
