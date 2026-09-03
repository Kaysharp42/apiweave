import type { Node } from "@xyflow/react";

/** How the minimap is painted. One object rather than four loose props: they are
 * always set together, by the canvas, from the same theme. */
export interface RunMiniMapPaint<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  nodeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeColor?: string | ((node: Node<TData>) => string);
  nodeStrokeWidth?: number;
  maskColor?: string;
}
