import type { CanvasNode } from "./CanvasNode";

export type GroupOutcome =
  | { readonly ok: true; readonly nodes: CanvasNode[]; readonly frameId: string }
  | { readonly ok: false; readonly reason: string };
