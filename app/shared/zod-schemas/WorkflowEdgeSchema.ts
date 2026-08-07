import { z } from "zod"

/**
 * A directed connection between two nodes.
 *
 * The `.describe()` calls are not decoration: `mcp/bridge.ts` derives each
 * tool's JSON argument schema straight from this shape, so they are the only
 * place an agent learns that an assertion's outgoing edges are handle-routed.
 * Getting that wrong produces a graph that saves cleanly and then silently
 * stops at the assertion node mid-run.
 */
export const WorkflowEdgeSchema = z
  .object({
    edgeId: z.string().min(1).describe("Unique id for this edge within the workflow."),
    source: z.string().min(1).describe("nodeId of the upstream node."),
    target: z.string().min(1).describe("nodeId of the downstream node."),
    sourceHandle: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Which output port of the source node this edge leaves from. REQUIRED on every edge leaving an assertion node, where it must be exactly "pass" or "fail" — an assertion routes its result down the matching branch, and an edge with no handle is never followed. Omit (or null) for every other node type, which has a single output.',
      ),
    targetHandle: z.string().nullable().optional().describe("Which input port of the target node this edge arrives at. Leave unset unless the target documents named inputs."),
    label: z.string().nullable().optional().describe("Optional display label shown on the canvas."),
  })
  .strict()
