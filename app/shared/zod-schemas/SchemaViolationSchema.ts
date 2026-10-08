import { z } from "zod"

/** One way a value failed a JSON Schema: where (a JSON Pointer into the value, "" for the value itself) and why. */
export const SchemaViolationSchema = z
  .object({
    path: z.string(),
    message: z.string(),
  })
  .strict()
