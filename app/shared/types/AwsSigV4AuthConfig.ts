import type { z } from "zod"
import type { AwsSigV4AuthConfigSchema } from "../zod-schemas/AuthConfigSchema"

export type AwsSigV4AuthConfig = z.infer<typeof AwsSigV4AuthConfigSchema>
