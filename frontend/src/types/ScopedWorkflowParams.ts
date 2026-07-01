/**
 * ScopedWorkflowParams — query parameters for workspace-scoped workflow listings.
 */
export interface ScopedWorkflowParams {
  /** The workspace to list workflows for. */
  workspaceId: string;
  /** Number of items to skip (for pagination). */
  skip?: number;
  /** Maximum number of items to return. */
  limit?: number;
  /** Include project-attached workflows (Projects view). Default false. */
  includeAttached?: boolean;
}
