import type { z } from "zod"
import type { ExtractorOutcomeSchema } from "../zod-schemas/ExtractorOutcomeSchema"

export type ExtractorOutcome = z.infer<typeof ExtractorOutcomeSchema>
