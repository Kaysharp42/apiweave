import type { z } from "zod"
import type { AssertionSourceSchema } from "../zod-schemas/AssertionSourceSchema"

export type AssertionSource = z.infer<typeof AssertionSourceSchema>
