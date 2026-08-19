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
  workflow?: Workflow;
  isDirty: boolean;
}
