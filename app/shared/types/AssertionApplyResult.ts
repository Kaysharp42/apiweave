import type { z } from "zod"
import type { AssertionApplyResultSchema } from "../zod-schemas/AssertionApplyResultSchema"

export type AssertionApplyResult = z.infer<typeof AssertionApplyResultSchema>
