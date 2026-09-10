import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowNodeMatchSchema } from "./WorkflowNodeMatchSchema"

/**
 * Bounded node-search result over one workflow's graph. `totalMatched` always
 * describes every match; when it exceeds the returned slice,
 * `omittedMatchCount` says how many were left out so the caller narrows the
 * query instead of assuming the slice is complete.
 */
export const NodeSearchPageSchema = z
  .object({
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    rev: RevisionSchema,
    query: z.string().max(200),
    items: z.array(WorkflowNodeMatchSchema),
    totalMatched: z.number().int().nonnegative(),
    omittedMatchCount: z.number().int().nonnegative(),
  })
  .strict()
