import { z } from "zod"
import { AssertionItemSchema } from "./AssertionItemSchema"

const AssertionValidationIssueSchema = z
  .object({
    ruleIndex: z.number().int().nonnegative().nullable(),
    code: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1),
  })
  .strict()

export const AssertionValidationResultSchema = z
  .object({
    workflowId: z.string().min(1),
    sourceNodeId: z.string().min(1),
    runId: z.string().min(1).optional(),
    valid: z.boolean(),
    compatible: z.boolean(),
    rules: z.array(AssertionItemSchema),
    issues: z.array(AssertionValidationIssueSchema),
    preview: z.array(z.string()),
  })
  .strict()
