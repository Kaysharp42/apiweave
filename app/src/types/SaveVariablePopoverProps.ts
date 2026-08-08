export interface SaveVariablePopoverProps {
  /** Viewport rect of the tree row button the popover points at. */
  anchorRect: DOMRect;
  /** Extractor path being stored, e.g. `response.body.data.id`. */
  path: string;
  /** Short rendering of the value at that path, shown for confirmation. */
  valuePreview: string;
  /** Pre-filled variable name, derived from the path. */
  initialName: string;
  /** Variable names already configured on the node, for collision warnings. */
  existingNames: readonly string[];
  onSave: (variableName: string) => void;
  onCancel: () => void;
}
