import type { NodeStatus } from "./NodeStatus";
import type { NodeRunLine } from "./NodeRunLine";
import type { NodeMetric } from "./NodeMetric";
import type { NodeProgress } from "./NodeProgress";

export interface NodeRunStripProps {
  status: NodeStatus;
  /** Current operation, shown while the node is running. */
  activityLine?: NodeRunLine;
  /** What happened, shown once the node has finished. */
  resultSummary?: NodeRunLine;
  /** Fixed-shape metrics row. Cells with a null value render an em dash. */
  metrics?: NodeMetric[];
  /** Rail state. Rendered only while running. */
  progress?: NodeProgress;
}
