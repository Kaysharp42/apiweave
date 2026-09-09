import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * Graph-free workflow discovery row. Carries identity, revision, ownership and
 * counts only — never configs, variables, positions or graph arrays, so a
 * workspace listing stays bounded independently of total graph size.
 */
export const WorkflowSummarySchema = z
  .object({
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    rev: RevisionSchema,
    collectionId: z.string().min(1).nullable(),
    selectedEnvironmentId: z.string().min(1).nullable(),
    tags: z.array(z.string()),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
  })
  .strict()
