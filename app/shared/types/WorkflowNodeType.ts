import type { z } from "zod"
import type { WorkflowNodeTypeSchema } from "../zod-schemas/WorkflowNodeTypeSchema"

export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>
