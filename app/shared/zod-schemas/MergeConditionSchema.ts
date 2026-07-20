import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"

export const MergeConditionSchema = z
  .object({
    branchIndex: z.number().int().nonnegative(),
    field: z.string().min(1),
    operator: z.enum(["equals", "notEquals", "contains", "gt", "lt", "gte", "lte", "exists"]),
    value: JsonValueSchema.optional(),
  })
  .strict()
