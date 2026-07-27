import { z } from "zod"
import { WorkflowDiagnosticSchema } from "./WorkflowDiagnosticSchema"

export const WorkflowDiagnosisSchema = z
  .object({
    workflowId: z.string().min(1),
    runId: z.string().min(1).optional(),
    summary: z
      .object({
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        notices: z.number().int().nonnegative(),
      })
      .strict(),
    diagnostics: z.array(WorkflowDiagnosticSchema),
  })
  .strict()
