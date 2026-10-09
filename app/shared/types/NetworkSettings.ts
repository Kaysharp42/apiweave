import type { z } from "zod"
import type { NetworkSettingsSchema } from "../zod-schemas/NetworkSettingsSchema"

export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>
