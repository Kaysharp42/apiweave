import type { z } from "zod"
import type { RunResumeRequestSchema } from "../zod-schemas/RunResumeRequestSchema"

export type RunResumeRequest = z.infer<typeof RunResumeRequestSchema>
