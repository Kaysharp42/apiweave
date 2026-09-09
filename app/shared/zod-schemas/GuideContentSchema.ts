import { z } from "zod"

export const GuideContentSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    uri: z.string().min(1),
    text: z.string().min(1),
  })
  .strict()
