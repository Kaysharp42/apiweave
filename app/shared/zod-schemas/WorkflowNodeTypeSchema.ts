import { z } from "zod"

/**
 * Every `type` a workflow node can have — the discriminants of
 * `WorkflowNodeSchema`. Named on its own so inputs that only pick a type (node
 * search filters, the loose node shape the MCP write tools advertise,
 * `workflows.nodeSchema`) do not each restate the list.
 */
export const WorkflowNodeTypeSchema = z.enum([
  "http-request",
  "sse",
  "websocket",
  "grpc",
  "assertion",
  "delay",
  "merge",
  "start",
  "end",
  "workflow",
  "group",
  "note",
])
