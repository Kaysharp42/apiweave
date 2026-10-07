import type { CanvasEdge } from "./CanvasEdge";
import type { CanvasNode } from "./CanvasNode";

/**
 * Copied canvas nodes and the edges between them. A node's `parentId` always
 * names a frame that is also on the clipboard.
 */
export interface CanvasClipboard {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
