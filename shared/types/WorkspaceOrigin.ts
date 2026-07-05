import type { z } from "zod"
import type { WorkspaceOriginSchema } from "../zod-schemas/WorkspaceOriginSchema"

export type WorkspaceOrigin = z.infer<typeof WorkspaceOriginSchema>
