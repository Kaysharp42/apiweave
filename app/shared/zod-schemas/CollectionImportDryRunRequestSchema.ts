import { z } from "zod"
import { CollectionBundleSchema } from "./CollectionBundleSchema"

export const CollectionImportDryRunRequestSchema = z
  .object({
    bundle: CollectionBundleSchema,
    createNewCollection: z.boolean().default(true),
    targetCollectionId: z.string().nullable().optional(),
  })
  .strict()
