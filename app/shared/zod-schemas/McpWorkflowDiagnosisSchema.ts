import { z } from "zod"

const McpWorkflowDiagnosisItemSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["error", "warning", "notice"]),
    category: z.enum(["topology", "dataflow", "assertion", "branch", "execution", "security"]),
    nodeIds: z.array(z.string().min(1)),
    message: z.string().min(1),
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
  })
  .strict()

const McpWorkflowDiagnosisSummarySchema = z
  .object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    notices: z.number().int().nonnegative(),
  })
  .strict()

export const McpWorkflowDiagnosisSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("complete"),
    summary: McpWorkflowDiagnosisSummarySchema,
    items: z.array(McpWorkflowDiagnosisItemSchema),
    omittedItemCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    message: z.string().min(1),
  }).strict(),
])
