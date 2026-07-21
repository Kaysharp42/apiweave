import type { z } from "zod"
import type { RunResultSchema } from "../zod-schemas/RunResultSchema"

export type RunResult = z.infer<typeof RunResultSchema>
