import type { z } from "zod"
import type { ApiKeyAuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type ApiKeyAuthConfig = z.infer<typeof ApiKeyAuthConfigSchema>
