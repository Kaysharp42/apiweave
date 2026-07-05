import { z } from "zod"

export const WorkflowOrderItemSchema = z
  .object({
    workflowId: z.string().min(1),
    order: z.number().int().nonnegative(),
    enabled: z.boolean().default(true),
    continueOnFail: z.boolean().default(true),
  })
  .strict()
