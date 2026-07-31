import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"

export const WorkflowDiagnosticSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["error", "warning", "notice"]),
    category: z.enum(["topology", "dataflow", "assertion", "branch", "execution", "security"]),
    nodeIds: z.array(z.string()),
    message: z.string().min(1),
    evidence: z.record(z.string(), JsonValueSchema),
    remediation: z
      .object({
        kind: z.string().min(1),
        nodeId: z.string().min(1).optional(),
        edgeId: z.string().min(1).optional(),
        path: z.string().optional(),
        variableName: z.string().min(1).optional(),
      })
      .strict()
      .nullable(),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict()
