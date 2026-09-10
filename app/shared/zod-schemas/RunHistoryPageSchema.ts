import { z } from "zod"
import { RunSummarySchema } from "./RunSummarySchema"

/**
 * One page of compact run history. `nextCursor` is present if and only if
 * more rows exist; like workflow search it is filter-bound and snapshot-bound,
 * so a stale cursor is rejected instead of silently skipping history.
 */
export const RunHistoryPageSchema = z
  .object({
    items: z.array(RunSummarySchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict()
