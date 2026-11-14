import type { z } from "zod"
import type { BrowserSettingsSchema } from "../zod-schemas/BrowserSettingsSchema"

export type BrowserSettings = z.infer<typeof BrowserSettingsSchema>
