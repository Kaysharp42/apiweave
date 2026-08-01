import type { z } from "zod"
import type { WorkflowCallNodeDataSchema } from "../zod-schemas/WorkflowCallNodeDataSchema"

export type WorkflowCallNodeData = z.infer<typeof WorkflowCallNodeDataSchema>
