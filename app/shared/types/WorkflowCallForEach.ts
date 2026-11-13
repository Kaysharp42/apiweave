import type { z } from "zod"
import type { WorkflowCallForEachSchema } from "../zod-schemas/WorkflowCallForEachSchema"

export type WorkflowCallForEach = z.infer<typeof WorkflowCallForEachSchema>
