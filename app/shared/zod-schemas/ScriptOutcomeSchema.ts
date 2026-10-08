import { z } from "zod"
import { ScriptTestResultSchema } from "./ScriptTestResultSchema"

/**
 * What one of an http-request node's scripts did: its console output, its
 * `aw.test` results, and the error that stopped it, with the script's line and
 * column. Secret values are masked like the rest of the run.
 */
export const ScriptOutcomeSchema = z
  .object({
    phase: z.enum(["preRequest", "postResponse"]),
    duration: z.number().int().nonnegative(),
    logs: z.array(z.string()),
    tests: z.array(ScriptTestResultSchema),
    error: z.string().optional(),
  })
  .strict()
