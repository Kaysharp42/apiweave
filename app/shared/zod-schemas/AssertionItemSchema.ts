import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"

/**
 * Assertion config as produced by BOTH renderer editors (the inline
 * `AssertionNode` form and the `AssertionConfigPanel` modal) and consumed by
 * the executor: `source` + `path` locate the value, `operator` compares it
 * against `expectedValue`. The operator enum is kept in sync with the UI
 * operator list and the executor's `compareValues`; drift there is what let
 * assertion nodes save-fail at the persistence boundary.
 */
export const AssertionItemSchema = z
  .object({
    source: z.string().optional(),
    path: z.string().optional(),
    operator: z.enum([
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
    ]),
    expectedValue: JsonValueSchema.optional(),
  })
  .strict()
