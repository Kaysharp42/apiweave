import type { z } from "zod"
import type { CollectionImportRequestSchema } from "../zod-schemas/CollectionImportRequestSchema"

export type CollectionImportRequest = z.infer<typeof CollectionImportRequestSchema>
