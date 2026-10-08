import type { z } from "zod"
import type { HttpRetryConfigSchema } from "../zod-schemas/HttpRetryConfigSchema"

export type HttpRetryConfig = z.infer<typeof HttpRetryConfigSchema>
