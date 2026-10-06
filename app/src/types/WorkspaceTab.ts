import type { Workflow } from "./Workflow";

export interface WorkspaceTab {
  id: string;
  workflowId: string;
  /**
   * The workspace the workflow lives in. Open tabs outlive a workspace switch,
   * so every view renders only the current workspace's tabs — a tab shown
   * under another workspace would send that workspace's id with this
   * workflow's id to the main process, which rejects the pair as not found.
   */
  workspaceId: string;
  name: string;
  /** The last workflow the server accepted. */
  workflow?: Workflow;
  /**
   * Unsaved canvas content, kept while the tab is not shown. Only the active
   * tab mounts a canvas, so switching away would otherwise drop it; the canvas
   * hydrates from this when the tab is shown again. Absent when the canvas
   * matched `workflow` as it left, and cleared by every save.
   */
  draft?: Workflow;
  isDirty: boolean;
}
