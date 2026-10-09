import type { z } from "zod"
import type { WorkflowRevisionSchema } from "../zod-schemas/WorkflowRevisionSchema"

export type WorkflowRevision = z.infer<typeof WorkflowRevisionSchema>
