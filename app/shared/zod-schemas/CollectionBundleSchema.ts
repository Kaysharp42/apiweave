import { z } from "zod"
import { CollectionSchema } from "./CollectionSchema"
import { EnvironmentSchema } from "./EnvironmentSchema"
import { WorkflowSchema } from "./WorkflowSchema"
import { WorkspaceSchema } from "./WorkspaceSchema"

export const CollectionBundleSchema = z
  .object({
    schemaVersion: z.literal(2),
    exportedAt: z.string(),
    workspace: WorkspaceSchema,
    collection: CollectionSchema,
    workflows: z.array(WorkflowSchema),
    environments: z.array(EnvironmentSchema).default([]),
  })
  .strict()
