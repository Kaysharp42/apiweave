import type { z } from "zod"
import type { RunSchema } from "../zod-schemas/RunSchema"

export type Run = z.infer<typeof RunSchema>

type RunAggregateMetadata = Pick<Run, "rev" | "createdAt" | "updatedAt">
type RunAggregateMetadataCheck = RunAggregateMetadata extends {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
  ? true
  : never
