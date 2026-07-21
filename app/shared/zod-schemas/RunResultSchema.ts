import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { RunnerNodeStatusSchema } from "./RunnerNodeStatusSchema"

export const RunResultSchema = z
  .object({
    nodeId: z.string().min(1),
    status: RunnerNodeStatusSchema,
    duration: z.number().int().nonnegative(),
    request: JsonValueSchema.nullable().optional(),
    response: JsonValueSchema.nullable().optional(),
    error: z.string().nullable().optional(),
    assertions: z.array(JsonValueSchema).nullable().optional(),
  })
  .strict()
