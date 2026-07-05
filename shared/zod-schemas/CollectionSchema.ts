import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"
import { WorkflowOrderItemSchema } from "./WorkflowOrderItemSchema"

export const CollectionSchema = z
  .object({
    collectionId: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().nullable().optional(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    workflowCount: z.number().int().nonnegative().default(0),
    workflowOrder: z.array(WorkflowOrderItemSchema).default([]),
    continueOnFail: z.boolean().default(true),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
