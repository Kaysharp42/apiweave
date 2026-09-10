import type { z } from "zod"
import type { WorkflowOutlineViewSchema } from "../zod-schemas/WorkflowOutlineViewSchema"

export type WorkflowOutlineView = z.infer<typeof WorkflowOutlineViewSchema>
