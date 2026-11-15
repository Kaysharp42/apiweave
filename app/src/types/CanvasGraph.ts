import type { CanvasEdge } from "./CanvasEdge";
import type { CanvasNode } from "./CanvasNode";

/** A canvas's nodes and edges together, for edits that change both at once. */
export interface CanvasGraph {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
}
