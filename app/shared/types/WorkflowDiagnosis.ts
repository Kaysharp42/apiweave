import type { z } from "zod"
import type { WorkflowDiagnosisSchema } from "../zod-schemas/WorkflowDiagnosisSchema"

export type WorkflowDiagnosis = z.infer<typeof WorkflowDiagnosisSchema>
