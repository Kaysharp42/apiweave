import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowNodeMatchSchema } from "./WorkflowNodeMatchSchema"

/**
 * One page of a node search, over one workflow (`workflowId` and `rev` set) or
 * every workflow of a workspace. `totalMatched` always describes every match
 * and `omittedMatchCount` how many this page leaves out; `nextCursor` is
 * present if and only if more matches follow, and is rejected once the
 * searched workflows change.
 */
export const NodeSearchPageSchema = z
  .object({
    workspaceId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    rev: RevisionSchema.optional(),
    items: z.array(WorkflowNodeMatchSchema),
    totalMatched: z.number().int().nonnegative(),
    omittedMatchCount: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict()
