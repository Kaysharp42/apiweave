import { z } from "zod"
import { JsonValueTypeSchema } from "./JsonValueTypeSchema"

export const ExtractorOutcomeSchema = z
  .object({
    producerNodeId: z.string().min(1),
    variableName: z.string().min(1),
    path: z.string(),
    matched: z.boolean(),
    observedType: JsonValueTypeSchema.nullable(),
    failureReason: z.enum(["path-missing", "type-mismatch"]).nullable().optional(),
  })
  .strict()
