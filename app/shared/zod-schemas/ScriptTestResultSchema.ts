import { z } from "zod"

/** One `aw.test(name, fn)` call: whether `fn` returned without throwing, and if not, why. */
export const ScriptTestResultSchema = z
  .object({
    name: z.string(),
    passed: z.boolean(),
    error: z.string().optional(),
  })
  .strict()
