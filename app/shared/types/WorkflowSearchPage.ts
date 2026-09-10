import type { z } from "zod"
import type { WorkflowSearchPageSchema } from "../zod-schemas/WorkflowSearchPageSchema"

export type WorkflowSearchPage = z.infer<typeof WorkflowSearchPageSchema>
