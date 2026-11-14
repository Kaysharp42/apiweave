import type { z } from "zod"
import type { BrowserStepResultSchema } from "../zod-schemas/BrowserStepResultSchema"

export type BrowserStepResult = z.infer<typeof BrowserStepResultSchema>
