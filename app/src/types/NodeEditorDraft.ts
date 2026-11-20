import type { MutableRefObject } from "react";

/**
 * The node editor's unsaved edits to one node. The editor stays mounted while
 * it steps from node to node, so a step swaps this for a fresh one.
 */
export interface NodeEditorDraft {
  readonly nodeId: string;
  /** The node's data with the edits so far. Every edit replaces `current`. */
  readonly working: MutableRefObject<Record<string, unknown>>;
  /** `working.current` as last applied to the node: a different object means unapplied edits. */
  applied: Record<string, unknown>;
}
