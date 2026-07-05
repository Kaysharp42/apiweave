import { z } from "zod"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const StartNodeDataSchema = z
  .object({
    label: z.string().optional(),
    executionStatus: RunnerNodeStatusSchema.optional(),
    config: z.object({}).strict().optional(),
  })
  .strict()
