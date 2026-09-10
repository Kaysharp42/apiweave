import type { z } from "zod"
import type { RunSummarySchema } from "../zod-schemas/RunSummarySchema"

export type RunSummary = z.infer<typeof RunSummarySchema>
