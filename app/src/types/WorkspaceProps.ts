export interface WorkspaceProps {
  /**
   * False while a page route's surface covers the canvas. The canvas is mounted
   * for the whole session so its tabs, viewport and unsaved edits survive a trip
   * through Settings, which means it has to stand down while it is hidden.
   */
  readonly active?: boolean;
}
