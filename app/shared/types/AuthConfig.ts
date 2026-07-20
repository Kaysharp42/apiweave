import type { z } from "zod"
import type { AuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type AuthConfig = z.infer<typeof AuthConfigSchema>
