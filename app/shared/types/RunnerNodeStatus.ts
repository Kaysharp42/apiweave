import type { z } from "zod"
import type { RunnerNodeStatusSchema } from "../zod-schemas/RunnerNodeStatusSchema"

export type RunnerNodeStatus = z.infer<typeof RunnerNodeStatusSchema>
