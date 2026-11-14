import type { z } from "zod"
import type { LoadLatencyStatsSchema } from "../zod-schemas/LoadLatencyStatsSchema"

export type LoadLatencyStats = z.infer<typeof LoadLatencyStatsSchema>
