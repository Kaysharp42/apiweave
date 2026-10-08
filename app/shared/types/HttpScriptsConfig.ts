import type { z } from "zod"
import type { HttpScriptsConfigSchema } from "../zod-schemas/HttpScriptsConfigSchema"

export type HttpScriptsConfig = z.infer<typeof HttpScriptsConfigSchema>
