import { z } from "zod"
import { MergeConditionSchema } from "./MergeConditionSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const MergeNodeDataSchema = z
  .object({
    label: z.string().optional(),
    executionStatus: RunnerNodeStatusSchema.optional(),
    status: RunnerNodeStatusSchema.optional(),
    config: z
      .object({
        mergeStrategy: z.enum(["all", "any", "first", "conditional"]).optional(),
        conditions: z.array(MergeConditionSchema).optional(),
      })
      .strict()
      .optional(),
    executionResult: z.record(z.string(), z.string()).optional(),
    result: z.record(z.string(), z.string()).optional(),
    incomingBranchCount: z.number().int().nonnegative().optional(),
  })
  .strict()
