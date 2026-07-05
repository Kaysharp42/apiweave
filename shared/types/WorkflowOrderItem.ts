import type { z } from "zod"
import type { WorkflowOrderItemSchema } from "../zod-schemas/WorkflowOrderItemSchema"

export type WorkflowOrderItem = z.infer<typeof WorkflowOrderItemSchema>
