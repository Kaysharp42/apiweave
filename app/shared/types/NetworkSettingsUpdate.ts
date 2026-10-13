import type { z } from "zod"
import type { NetworkSettingsUpdateSchema } from "../zod-schemas/NetworkSettingsSchema"

export type NetworkSettingsUpdate = z.infer<typeof NetworkSettingsUpdateSchema>
