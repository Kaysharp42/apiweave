import type { z } from "zod"
import type { LoadNodeStatsSchema } from "../zod-schemas/LoadNodeStatsSchema"

export type LoadNodeStats = z.infer<typeof LoadNodeStatsSchema>
