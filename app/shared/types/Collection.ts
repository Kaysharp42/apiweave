import type { z } from "zod"
import type { CollectionSchema } from "../zod-schemas/CollectionSchema"

export type Collection = z.infer<typeof CollectionSchema>
