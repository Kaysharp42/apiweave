import type { z } from "zod"
import type { WorkspaceMapPageSchema } from "../zod-schemas/WorkspaceMapPageSchema"

export type WorkspaceMapPage = z.infer<typeof WorkspaceMapPageSchema>
