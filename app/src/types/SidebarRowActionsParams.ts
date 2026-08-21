import type { Workflow } from "./Workflow";

/** What `useSidebarRowActions` needs from the sidebar to run a row action. */
export interface SidebarRowActionsParams {
  readonly workspaceId: string | null;
  readonly isScopeReady: boolean;
  readonly selectedNav: string;
  readonly refreshAll: (selectedNav: string) => Promise<void>;
  /**
   * Every workflow in the workspace, read BEFORE a move — a project's members
   * have to be identified while they still answer to this workspace's list.
   */
  readonly allWorkflows: readonly Workflow[];
  /** A workflow has left the workspace: drop it as the selected row. */
  readonly onWorkflowLeft: (workflowId: string) => void;
  /** A project has left the workspace: collapse it. */
  readonly onProjectLeft: (projectId: string) => void;
}
