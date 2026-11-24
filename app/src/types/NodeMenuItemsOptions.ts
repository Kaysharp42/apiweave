import type { ContextMenuItem } from "./ContextMenuItem";

/** Everything `buildNodeMenuItems` needs to assemble one node's action menu. */
export interface NodeMenuItemsOptions {
  /** The node can be run from here (it is a step, not a start/end/note/frame). */
  readonly runnable: boolean;
  /** The node's config can be saved to the workspace preset library. */
  readonly presetable: boolean;
  /** The node can expand/collapse, so the menu offers the toggle. */
  readonly collapsible: boolean;
  readonly isExpanded: boolean;
  /** Browser-step actions the node type supports, already filtered for this node. */
  readonly stepActions: readonly ContextMenuItem[];
  /** Platform chords, resolved by the caller so the builder stays pure. */
  readonly shortcuts: {
    readonly duplicate: string;
    readonly copy: string;
    readonly delete: string;
  };
  readonly onRunFrom: () => void;
  readonly onDuplicate: () => void;
  readonly onCopy: () => void;
  readonly onSavePreset: () => void;
  readonly onToggleExpand: () => void;
  readonly onDelete: () => void;
}
