import type { z } from "zod"
import type { NodePresetSchema } from "../zod-schemas/NodePresetSchema"

export type NodePreset = z.infer<typeof NodePresetSchema>
