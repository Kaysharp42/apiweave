import type { z } from "zod"
import type { WorkflowGetViewSchema } from "../zod-schemas/WorkflowGetViewSchema"

export type WorkflowGetView = z.infer<typeof WorkflowGetViewSchema>
