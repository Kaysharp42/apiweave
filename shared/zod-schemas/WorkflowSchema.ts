import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"
import { WorkflowEdgeSchema } from "./WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "./WorkflowNodeSchema"

export const WorkflowSchema = z
  .object({
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    nodes: z.array(WorkflowNodeSchema).default([]),
    edges: z.array(WorkflowEdgeSchema).default([]),
    variables: z.record(z.string(), JsonValueSchema).default({}),
    tags: z.array(z.string()).default([]),
    collectionId: z.string().nullable().optional(),
    selectedEnvironmentId: z.string().nullable().optional(),
    nodeTemplates: z.array(JsonValueSchema).default([]),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
