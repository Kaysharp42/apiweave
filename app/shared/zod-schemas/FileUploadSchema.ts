import { z } from "zod"

export const FileUploadSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["path", "base64", "variable"]),
    value: z.string(),
    fieldName: z.string().min(1),
    mimeType: z.string().default("application/octet-stream"),
    description: z.string().nullable().optional(),
  })
  .strict()
