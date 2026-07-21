import type { z } from "zod"
import type { BasicAuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type BasicAuthConfig = z.infer<typeof BasicAuthConfigSchema>
