import type { MutableRefObject } from "react";
import type { CanvasNode } from "./CanvasNode";

export interface UseTurnIntoExtractParams {
  /** The canvas's committed nodes, which the open target and the dialog read as they are now. */
  readonly nodes: readonly CanvasNode[];
  /** The canvas's latest nodes, which a save reads; updated before `setNodes` like every other programmatic edit. */
  readonly nodesRef: MutableRefObject<CanvasNode[]>;
  readonly setNodes: (nodes: CanvasNode[]) => void;
}
