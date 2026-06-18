/**
 * ScopedProjectParams — query parameters for workspace-scoped project operations.
 */
export interface ScopedProjectParams {
  /** The workspace to list / operate on projects for. */
  workspaceId: string;
  /** Optional project ID when targeting a specific project. */
  projectId?: string;
}
