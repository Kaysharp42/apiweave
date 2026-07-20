import type { z } from "zod"
import type { WorkflowEdgeSchema } from "../zod-schemas/WorkflowEdgeSchema"

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
