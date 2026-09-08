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
        'Which output port of the source node this edge leaves from. Assertion edges must use exactly "pass" or "fail". SSE edges must use "ready" (after the stream handshake) or "complete" (after its final bounded result exists). An edge without its source node\'s documented handle is never followed. Omit (or null) sourceHandle only for single-output node types.',
      ),
    targetHandle: z.string().nullable().optional().describe("Which input port of the target node this edge arrives at. Leave unset unless the target documents named inputs."),
    label: z.string().nullable().optional().describe("Optional display label shown on the canvas."),
  })
  .strict()
