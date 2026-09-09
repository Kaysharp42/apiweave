import { z } from "zod"
import { WorkflowSummarySchema } from "./WorkflowSummarySchema"

/**
 * One page of workflow discovery results. `nextCursor` is an opaque,
 * filter-bound, revision-safe cursor: it is present if and only if more rows
 * exist, and a cursor issued against a changed list is rejected so the caller
 * re-reads from the start instead of silently skipping rows.
 */
export const WorkflowSearchPageSchema = z
  .object({
    items: z.array(WorkflowSummarySchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict()
