import type { z } from "zod"
import type { PostmanImportResultSchema } from "../zod-schemas/PostmanImportResultSchema"

export type PostmanImportResult = z.infer<typeof PostmanImportResultSchema>
