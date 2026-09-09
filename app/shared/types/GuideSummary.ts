import type { z } from "zod"
import type { GuideSummarySchema } from "../zod-schemas/GuideSummarySchema"

export type GuideSummary = z.infer<typeof GuideSummarySchema>
