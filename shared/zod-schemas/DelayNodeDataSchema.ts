import { z } from "zod"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const DelayNodeDataSchema = z
  .object({
    label: z.string().optional(),
    executionStatus: RunnerNodeStatusSchema.optional(),
    config: z
      .object({
        duration: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
