import type { z } from "zod"
import type { AssertionOperatorSchema } from "../zod-schemas/AssertionOperatorSchema"

export type AssertionOperator = z.infer<typeof AssertionOperatorSchema>
