/** What the node editor's dialog asks of the editor inside it. */
export interface NodeEditorHandle {
  /** Escape or a press outside the dialog: apply the draft, then close. */
  readonly close: () => void;
}
