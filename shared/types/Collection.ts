import type { z } from "zod"
import type { CollectionSchema } from "../zod-schemas/CollectionSchema"

export type Collection = z.infer<typeof CollectionSchema>

type CollectionAggregateMetadata = Pick<Collection, "rev" | "createdAt" | "updatedAt">
type CollectionAggregateMetadataCheck = CollectionAggregateMetadata extends {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
  ? true
  : never
