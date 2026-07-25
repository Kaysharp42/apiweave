import type { z } from "zod"
import type { ResolvedSecretInfoSchema } from "../zod-schemas/ResolvedSecretInfoSchema"

export type ResolvedSecretInfo = z.infer<typeof ResolvedSecretInfoSchema>