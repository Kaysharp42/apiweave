/**
 * What a tab with possibly-unsaved work offers the code about to close it
 * (its mounted canvas, or the draft it left behind): a way to
 * send its pending auto-save, to tell whether anything is still unsaved, and
 * to save explicitly when the user asks to.
 */
export interface PendingEdits {
  /** Sends a pending auto-save now and resolves once it has settled. */
  flush: () => Promise<void>;
  /** Whether the canvas differs from the last workflow the server accepted. */
  isUnsaved: () => boolean;
  /** An explicit save, as the Save button and Ctrl+S make. */
  save: () => Promise<void>;
}
