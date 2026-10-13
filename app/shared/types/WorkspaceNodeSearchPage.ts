import type { z } from "zod"
import type { WorkspaceNodeSearchPageSchema } from "../zod-schemas/WorkspaceNodeSearchPageSchema"

export type WorkspaceNodeSearchPage = z.infer<typeof WorkspaceNodeSearchPageSchema>
