import type { z } from "zod"
import type { WorkspaceMapEntrySchema } from "../zod-schemas/WorkspaceMapEntrySchema"

export type WorkspaceMapEntry = z.infer<typeof WorkspaceMapEntrySchema>
