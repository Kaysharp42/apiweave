import type { z } from "zod"
import type { WorkspaceNodeMatchSchema } from "../zod-schemas/WorkspaceNodeMatchSchema"

export type WorkspaceNodeMatch = z.infer<typeof WorkspaceNodeMatchSchema>
