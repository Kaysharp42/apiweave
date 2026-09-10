import type { z } from "zod"
import type { WorkflowNodesViewSchema } from "../zod-schemas/WorkflowNodesViewSchema"

export type WorkflowNodesView = z.infer<typeof WorkflowNodesViewSchema>
