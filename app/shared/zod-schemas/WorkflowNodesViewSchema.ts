import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowEdgeSchema } from "./WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "./WorkflowNodeSchema"

const BoundaryNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
  })
  .strict()

/**
 * Targeted node read: full configs for the requested nodes, every edge
 * incident to them (so a patch can rewire without a full read), and minimal
 * identities for neighbours outside the set. Always marked partial, and
 * unknown ids are reported rather than silently dropped.
 */
export const WorkflowNodesViewSchema = z
  .object({
    view: z.literal("nodes"),
    partial: z.literal(true),
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    rev: RevisionSchema,
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    nodes: z.array(WorkflowNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
    boundaryNodes: z.array(BoundaryNodeSchema),
    missingNodeIds: z.array(z.string().min(1)),
  })
  .strict()
