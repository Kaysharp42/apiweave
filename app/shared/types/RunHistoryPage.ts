import type { z } from "zod"
import type { RunHistoryPageSchema } from "../zod-schemas/RunHistoryPageSchema"

export type RunHistoryPage = z.infer<typeof RunHistoryPageSchema>
