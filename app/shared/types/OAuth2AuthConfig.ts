import type { z } from "zod"
import type { OAuth2AuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type OAuth2AuthConfig = z.infer<typeof OAuth2AuthConfigSchema>
