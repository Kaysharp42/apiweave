import type { z } from "zod"
import type { WorkspaceSyncModeSchema } from "../zod-schemas/WorkspaceSyncModeSchema"

export type WorkspaceSyncMode = z.infer<typeof WorkspaceSyncModeSchema>
