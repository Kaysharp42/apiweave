import type { z } from "zod"
import type { HttpAttemptSchema } from "../zod-schemas/HttpAttemptSchema"

export type HttpAttempt = z.infer<typeof HttpAttemptSchema>
