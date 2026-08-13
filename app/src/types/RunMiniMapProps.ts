import type { CSSProperties } from "react";
import type { Node, PanelPosition } from "reactflow";

/**
 * A minimap that reads the graph from the canvas state and can be frozen while
 * the run camera moves.
 *
 * The stock ReactFlow `MiniMap` derives its picture from the store, so every
 * viewport write the camera makes — sixty a second while it is moving —
 * re-runs its bounds computation over every node and repaints its viewport
 * rectangle. Freezing it for the duration of a burst of motion makes the cost
 * of following a run independent of the minimap, and it thaws the moment the
 * camera comes to rest.
 */
export interface RunMiniMapProps<TData = unknown> {
  /** Canvas nodes, from `WorkflowCanvas` state — not the store. Passed as a
   * prop so the node layer repaints only when the graph changes, which a store
   * subscription could not tell apart from viewport noise. */
  nodes: Node<TData>[];
  /** Freeze the viewport rectangle: the run camera is mid-motion. */
  frozen: boolean;
  position?: PanelPosition;
  style?: CSSProperties;
  className?: string;
  nodeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeWidth?: number;
  nodeBorderRadius?: number;
  maskColor?: string;
  zoomable?: boolean;
  pannable?: boolean;
}
