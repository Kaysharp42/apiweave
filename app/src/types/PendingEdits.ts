/**
 * What a mounted canvas offers the code that is about to close it: a way to
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
