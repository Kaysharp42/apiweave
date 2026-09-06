import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasEdge } from "./CanvasEdge";
import type { CanvasNode } from "./CanvasNode";

export interface CanvasHistoryEntry {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
  readonly variables: Record<string, JsonValue>;
  /** The persisted shape, serialised. Equal signatures are the same edit. */
  readonly sig: string;
}
