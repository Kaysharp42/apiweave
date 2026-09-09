import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowEdgeSchema } from "./WorkflowEdgeSchema"

const OutlineNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
  })
  .strict()

/**
 * Bounded structural overview of a workflow: identity, revision, node
 * ids/types/labels and the full edge structure. Canvas positions and config
 * bodies are excluded, so an outline never carries per-node payload weight.
 * Always marked partial — it is a map for targeted reads, not the graph.
 */
export const WorkflowOutlineViewSchema = z
  .object({
    view: z.literal("outline"),
    partial: z.literal(true),
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    rev: RevisionSchema,
    collectionId: z.string().min(1).nullable(),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    nodes: z.array(OutlineNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
    omittedNodeCount: z.number().int().nonnegative(),
    omittedEdgeCount: z.number().int().nonnegative(),
    nextNodeCursor: z.string().min(1).nullable(),
  })
  .strict()
