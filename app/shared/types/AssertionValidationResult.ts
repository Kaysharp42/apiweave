import type { z } from "zod"
import type { AssertionValidationResultSchema } from "../zod-schemas/AssertionValidationResultSchema"

export type AssertionValidationResult = z.infer<typeof AssertionValidationResultSchema>
