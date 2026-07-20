import type { z } from "zod"
import type { WorkflowNodeSchema } from "../zod-schemas/WorkflowNodeSchema"

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
