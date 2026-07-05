import type { z } from "zod"
import type { WorkspaceSchema } from "../zod-schemas/WorkspaceSchema"

export type Workspace = z.infer<typeof WorkspaceSchema>

type WorkspaceAggregateMetadata = Pick<Workspace, "rev" | "createdAt" | "updatedAt">
type WorkspaceAggregateMetadataCheck = WorkspaceAggregateMetadata extends {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
  ? true
  : never
