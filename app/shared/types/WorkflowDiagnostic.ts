import type { z } from "zod"
import type { WorkflowDiagnosticSchema } from "../zod-schemas/WorkflowDiagnosticSchema"

export type WorkflowDiagnostic = z.infer<typeof WorkflowDiagnosticSchema>
