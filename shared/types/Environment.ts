import type { z } from "zod"
import type { EnvironmentSchema } from "../zod-schemas/EnvironmentSchema"

export type Environment = z.infer<typeof EnvironmentSchema>

type EnvironmentAggregateMetadata = Pick<Environment, "rev" | "createdAt" | "updatedAt">
type EnvironmentAggregateMetadataCheck = EnvironmentAggregateMetadata extends {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
  ? true
  : never
