import type { z } from "zod"
import type { WorkflowSchema } from "../zod-schemas/WorkflowSchema"

export type Workflow = z.infer<typeof WorkflowSchema>
