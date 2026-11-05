import type { CanvasToolbarOverflowMenuProps } from "./CanvasToolbarOverflowMenuProps";

/** The toolbar's lower-priority actions and the menu they fold into. */
export interface CanvasToolbarSecondaryActionsProps {
  readonly showLabels: boolean;
  readonly showSecondaryInline: boolean;
  readonly showHistoryInline: boolean;
  readonly showOverflow: boolean;
  readonly onCommandPalette: () => void;
  readonly onHistory: () => void;
  readonly onVersionHistory: () => void;
  readonly onJsonEditor: () => void;
  readonly onImport: () => void;
  /** What the overflow menu needs, composed here rather than passed as a node. */
  readonly overflow: CanvasToolbarOverflowMenuProps;
}
