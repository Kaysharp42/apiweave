import type { z } from "zod"
import type { CollectionImportDryRunRequestSchema } from "../zod-schemas/CollectionImportDryRunRequestSchema"

export type CollectionImportDryRunRequest = z.infer<typeof CollectionImportDryRunRequestSchema>
