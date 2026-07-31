import type { z } from "zod"
import type { AssertionEvaluationSchema } from "../zod-schemas/AssertionEvaluationSchema"

export type AssertionEvaluation = z.infer<typeof AssertionEvaluationSchema>
