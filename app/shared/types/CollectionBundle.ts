import type { z } from "zod"
import type { CollectionBundleSchema } from "../zod-schemas/CollectionBundleSchema"

export type CollectionBundle = z.infer<typeof CollectionBundleSchema>
