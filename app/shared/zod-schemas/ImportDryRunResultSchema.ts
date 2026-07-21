import { z } from "zod"

export const ImportDryRunResultSchema = z
  .object({
    valid: z.boolean(),
    workflowCount: z.number().int().nonnegative(),
    environmentCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()).default([]),
    errors: z.array(z.string()).default([]),
  })
  .strict()
