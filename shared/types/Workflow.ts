import type { z } from "zod"
import type { WorkflowSchema } from "../zod-schemas/WorkflowSchema"

export type Workflow = z.infer<typeof WorkflowSchema>

type WorkflowAggregateMetadata = Pick<Workflow, "rev" | "createdAt" | "updatedAt">
type WorkflowAggregateMetadataCheck = WorkflowAggregateMetadata extends {
  readonly rev: number
  readonly createdAt: string
  readonly updatedAt: string
}
  ? true
  : never
