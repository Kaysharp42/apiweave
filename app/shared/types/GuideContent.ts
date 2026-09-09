import type { z } from "zod"
import type { GuideContentSchema } from "../zod-schemas/GuideContentSchema"

export type GuideContent = z.infer<typeof GuideContentSchema>
