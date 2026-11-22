import type { BrowserNodeData } from "./BrowserNodeData";
import type { NodeStatus } from "./NodeStatus";

export interface BrowserNodeBodyProps {
  nodeId: string;
  status: NodeStatus;
  /** What the step does, as the collapsed node's rest line shows it. */
  summary: { operation: string; argument?: string };
  result: BrowserNodeData["executionResult"];
}
