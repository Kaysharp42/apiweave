import type { z } from "zod"
import type { WorkflowNodeMatchSchema } from "../zod-schemas/WorkflowNodeMatchSchema"

export type WorkflowNodeMatch = z.infer<typeof WorkflowNodeMatchSchema>
