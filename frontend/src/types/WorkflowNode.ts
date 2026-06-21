import type { NodeType } from "./NodeType";
import type { NodeData } from "./NodeData";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}
