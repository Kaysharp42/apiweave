import { z } from "zod"
import { AssertionOperatorSchema } from "./AssertionOperatorSchema"
import { AssertionSourceSchema } from "./AssertionSourceSchema"
import { JsonValueTypeSchema } from "./JsonValueTypeSchema"

export const AssertionEvaluationSchema = z
  .object({
    ruleIndex: z.number().int().nonnegative(),
    source: AssertionSourceSchema,
    path: z.string(),
    operator: AssertionOperatorSchema,
    sourceNodeId: z.string().min(1).nullable(),
    expectedState: z.enum(["not-required", "literal", "resolved-template", "unresolved-template", "legacy"]),
    expectedType: JsonValueTypeSchema.nullable(),
    actualState: z.enum(["present", "missing", "source-unavailable", "ambiguous-source", "not-evaluated"]),
    actualType: JsonValueTypeSchema.nullable(),
    outcome: z.enum(["pass", "fail", "skipped"]),
    reasonCode: z.enum([
      "passed",
      "comparison-failed",
      "source-unavailable",
      "ambiguous-source",
      "template-unresolved",
      "comparison-error",
      "skipped-after-failure",
      "legacy-result",
    ]),
  })
  .strict()
