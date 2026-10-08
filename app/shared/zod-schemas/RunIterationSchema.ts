import { z } from "zod"

/**
 * Where a run sits in a data-driven run: iteration `index` (1-based) of
 * `count`, one run per data row, all sharing `groupId`. The row's values are
 * never stored with the run — only its position.
 */
export const RunIterationSchema = z
  .object({
    groupId: z.string().min(1),
    index: z.number().int().positive(),
    count: z.number().int().positive(),
  })
  .strict()
