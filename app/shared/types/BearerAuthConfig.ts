import type { z } from "zod"
import type { BearerAuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type BearerAuthConfig = z.infer<typeof BearerAuthConfigSchema>
