import type { Node } from "reactflow";

/** How the minimap is painted. One object rather than four loose props: they are
 * always set together, by the canvas, from the same theme. */
export interface RunMiniMapPaint<TData = unknown> {
  nodeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeWidth?: number;
  maskColor?: string;
}
