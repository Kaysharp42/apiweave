import type { Workflow } from "../types/Workflow"

const INITIAL_START_NODE_ID = "start-1"
const INITIAL_END_NODE_ID = "end-1"

/**
 * The graph a new workflow starts with: Start → End. Every create path the
 * user can reach uses it, so a fresh workflow is already complete for the
 * analyzer and whatever is added after Start lands before End.
 */
export function initialWorkflowGraph(): Pick<Workflow, "nodes" | "edges"> {
  return {
    nodes: [
      { nodeId: INITIAL_START_NODE_ID, type: "start", label: "Start", position: { x: 100, y: 100 }, config: {} },
      { nodeId: INITIAL_END_NODE_ID, type: "end", label: "End", position: { x: 500, y: 100 }, config: {} },
    ],
    edges: [{ edgeId: `edge-${INITIAL_START_NODE_ID}-${INITIAL_END_NODE_ID}`, source: INITIAL_START_NODE_ID, target: INITIAL_END_NODE_ID }],
  }
}
