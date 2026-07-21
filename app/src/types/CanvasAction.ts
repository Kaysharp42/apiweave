import type { CanvasActionType } from "./CanvasActionType";

export interface CanvasAction {
  type: CanvasActionType;
  nodeId?: string;
  timestamp: number;
}
