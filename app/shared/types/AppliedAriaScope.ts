import type { z } from "zod"
import type { AppliedAriaScopeSchema } from "../zod-schemas/AriaScopeSchema"

export type AppliedAriaScope = z.infer<typeof AppliedAriaScopeSchema>
