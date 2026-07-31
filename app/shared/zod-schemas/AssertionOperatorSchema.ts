import { z } from "zod"

export const AssertionOperatorSchema = z.enum([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "gt",
  "gte",
  "lt",
  "lte",
  "count",
  "exists",
  "notExists",
])
