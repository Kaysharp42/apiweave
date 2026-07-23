import { z } from "zod"

export const DelayJitterConfigSchema = z
  .object({
    minMs: z.number().int().nonnegative(),
    maxMs: z.number().int().nonnegative(),
  })
  .strict()
