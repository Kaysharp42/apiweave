import type { z } from "zod"
import type { WorkspaceSchema } from "../zod-schemas/WorkspaceSchema"

export type Workspace = z.infer<typeof WorkspaceSchema>
