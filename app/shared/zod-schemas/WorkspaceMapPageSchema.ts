import { z } from "zod"
import { WorkspaceMapEntrySchema } from "./WorkspaceMapEntrySchema"

/** One page of the workspace map, newest-updated workflow first. */
export const WorkspaceMapPageSchema = z
  .object({
    items: z.array(WorkspaceMapEntrySchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict()
