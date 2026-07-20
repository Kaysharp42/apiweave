import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"

export const AssertionItemSchema = z
  .object({
    field: z.string().min(1),
    operator: z.enum(["equals", "notEquals", "contains", "gt", "lt", "gte", "lte", "exists"]),
    expected: JsonValueSchema.optional(),
  })
  .strict()
