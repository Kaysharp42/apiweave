import type { z } from "zod"
import type { AriaScopeSchema } from "../zod-schemas/AriaScopeSchema"

export type AriaScope = z.infer<typeof AriaScopeSchema>
