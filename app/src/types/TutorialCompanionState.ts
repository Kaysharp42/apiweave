/**
 * Ephemeral companion presentation state. Never persisted: after a reload the
 * companion is closed and the reader is left alone, even though the practice
 * lesson and step are restored from the progress store.
 *
 * `isCollapsed` drives the wide floating panel (a collapsed panel is a strip).
 * `isExpanded` drives the compact presentation, where the instructions only
 * cover the content after an explicit expand — a compact companion opens as a
 * strip so it never hides the workspace unasked.
 */
export interface TutorialCompanionState {
  isOpen: boolean;
  isCollapsed: boolean;
  isExpanded: boolean;
  /** Where the companion's "Return to workspace" action goes. */
  returnPath: string | null;
  /** Open the companion and remember the workspace path to return to. */
  openCompanion: (returnPath: string) => void;
  collapseCompanion: () => void;
  expandCompanion: () => void;
  closeCompanion: () => void;
  /**
   * Hide the companion without ending practice. Used when navigating to a
   * destination outside the shell (Cloud), where the companion cannot render.
   */
  pauseCompanion: () => void;
}
