import { z } from "zod"
import { WorkspaceNodeMatchSchema } from "./WorkspaceNodeMatchSchema"

/** Bounded node search across every workflow of a workspace; `totalMatched` counts every match. */
export const WorkspaceNodeSearchPageSchema = z
  .object({
    query: z.string().max(200),
    items: z.array(WorkspaceNodeMatchSchema),
    totalMatched: z.number().int().nonnegative(),
    omittedMatchCount: z.number().int().nonnegative(),
  })
  .strict()
