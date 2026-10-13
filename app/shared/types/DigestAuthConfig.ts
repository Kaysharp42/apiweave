import type { z } from "zod"
import type { DigestAuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type DigestAuthConfig = z.infer<typeof DigestAuthConfigSchema>
