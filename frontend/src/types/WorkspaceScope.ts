/**
 * WorkspaceScope — types for workspace-scoped data fetching and display.
 */

/** Response shape for workspace-scoped project listing. */
export interface WorkspaceProjectListResponse {
  projects: import('./Project').Project[];
  total: number;
}

/** Response shape for workspace-scoped workflow listing. */
export interface WorkspaceWorkflowListResponse {
  workflows: import('./Workflow').Workflow[];
  total: number;
}

/** Parameters for fetching workspace-scoped resources. */
export interface WorkspaceScopeParams {
  workspaceId: string;
  projectId?: string;
}
