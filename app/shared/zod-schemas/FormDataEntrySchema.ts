import { z } from "zod"

export const FormDataEntrySchema = z
  .object({
    key: z.string(),
    value: z.string(),
    type: z.enum(["text", "file"]),
    active: z.boolean(),
  })
  .strict()