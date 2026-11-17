import type { MutableRefObject } from "react";
import type { CanvasNode } from "./CanvasNode";

export interface UseTurnIntoExtractParams {
  /** The canvas's latest nodes, which a save reads; updated before `setNodes` like every other programmatic edit. */
  readonly nodesRef: MutableRefObject<CanvasNode[]>;
  readonly setNodes: (nodes: CanvasNode[]) => void;
}
