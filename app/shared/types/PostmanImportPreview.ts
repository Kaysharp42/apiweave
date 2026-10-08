import type { z } from "zod"
import type { PostmanImportPreviewSchema } from "../zod-schemas/PostmanImportPreviewSchema"

export type PostmanImportPreview = z.infer<typeof PostmanImportPreviewSchema>
