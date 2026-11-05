/** The toolbar's `⋯` menu: whatever the current density could not keep inline. */
export interface CanvasToolbarOverflowMenuProps {
  readonly showStructureInline: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canGroup: boolean;
  readonly canUngroup: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onCommandPalette: () => void;
  readonly showHistoryInline: boolean;
  readonly onHistory: () => void;
  readonly onJsonEditor: () => void;
  readonly onImport: () => void;
}
