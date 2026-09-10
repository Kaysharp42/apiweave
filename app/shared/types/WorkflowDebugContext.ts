import type { z } from "zod"
import type { WorkflowDebugContextSchema } from "../zod-schemas/WorkflowDebugContextSchema"

export type WorkflowDebugContext = z.infer<typeof WorkflowDebugContextSchema>
