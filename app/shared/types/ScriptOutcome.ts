import type { z } from "zod"
import type { ScriptOutcomeSchema } from "../zod-schemas/ScriptOutcomeSchema"

export type ScriptOutcome = z.infer<typeof ScriptOutcomeSchema>
