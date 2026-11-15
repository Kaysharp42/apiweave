import type { MutableRefObject } from "react";
import type { CanvasEdge } from "./CanvasEdge";
import type { CanvasNode } from "./CanvasNode";

export interface UseBrowserRecordingParams {
  readonly workflowId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly environmentId: string | null;
  readonly isHydrated: boolean;
  readonly isRunning: boolean;
  /** The canvas's latest graph, which a save reads; updated before `setNodes` like every other programmatic edit. */
  readonly nodesRef: MutableRefObject<CanvasNode[]>;
  readonly edgesRef: MutableRefObject<CanvasEdge[]>;
  readonly setNodes: (nodes: CanvasNode[]) => void;
  readonly setEdges: (edges: CanvasEdge[]) => void;
}
