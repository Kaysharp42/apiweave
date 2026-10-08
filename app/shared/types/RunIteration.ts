import type { z } from "zod"
import type { RunIterationSchema } from "../zod-schemas/RunIterationSchema"

export type RunIteration = z.infer<typeof RunIterationSchema>
