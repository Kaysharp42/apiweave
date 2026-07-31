import type { z } from "zod"
import type { AssertionSuggestionResultSchema } from "../zod-schemas/AssertionSuggestionResultSchema"

export type AssertionSuggestionResult = z.infer<typeof AssertionSuggestionResultSchema>
