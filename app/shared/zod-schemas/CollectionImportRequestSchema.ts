import { z } from "zod"
import { CollectionBundleSchema } from "./CollectionBundleSchema"

export const CollectionImportRequestSchema = z
  .object({
    bundle: CollectionBundleSchema,
    createNewCollection: z.boolean().default(true),
    newCollectionName: z.string().nullable().optional(),
    targetCollectionId: z.string().nullable().optional(),
    environmentMapping: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict()
