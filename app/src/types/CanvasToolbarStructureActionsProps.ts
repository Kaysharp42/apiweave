/** Undo/redo and frame/ungroup: the structure edits, inline until the last density step. */
export interface CanvasToolbarStructureActionsProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canGroup: boolean;
  readonly canUngroup: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
}
