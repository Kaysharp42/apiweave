import { z } from "zod"
import { AssertionItemSchema } from "./AssertionItemSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const AssertionNodeDataSchema = z
  .object({
    label: z.string().optional(),
    executionStatus: RunnerNodeStatusSchema.optional(),
    config: z
      .object({
        assertions: z.array(AssertionItemSchema).optional(),
      })
      .strict()
      .optional(),
    invalid: z.boolean().optional(),
  })
  .strict()
