import type { z } from "zod"
import type { JwtAuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type JwtAuthConfig = z.infer<typeof JwtAuthConfigSchema>
