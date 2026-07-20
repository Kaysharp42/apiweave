import { z } from "zod"

export const UrlEncodedEntrySchema = z
  .object({
    key: z.string(),
    value: z.string(),
    active: z.boolean(),
  })
  .strict()