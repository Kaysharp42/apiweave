import type { z } from "zod"
import type { LoadRunSettingsSchema } from "../zod-schemas/LoadRunSettingsSchema"

export type LoadRunSettings = z.infer<typeof LoadRunSettingsSchema>
