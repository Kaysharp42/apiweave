import type { NodeStatus } from "./NodeStatus";

/**
 * What the canvas stores on a `start` or `end` node.
 *
 * Neither carries config, so `executionStatus` is the whole of it: the runner
 * stamps the entry point as passed when a run begins and each end node as
 * passed when control reaches it, and those are reported exactly like any
 * other node's.
 */
export interface TerminalNodeData {
  label?: string;
  executionStatus?: NodeStatus;
}
