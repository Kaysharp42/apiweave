/**
 * Project — workspace-scoped grouping of workflows.
 * Maps to the SQLite `collections` table (backend type: `Collection`).
 */
export interface Project {
  /** Internal document ID. */
  id: string;
  /** The project's id: the primary key in the DB, and the `projectId` of project runs. */
  collectionId: string;
  /** Display name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Optional colour hex code, e.g. "#FF5733". */
  color?: string;
  /** Number of workflows in this project. */
  workflowCount: number;
  /** Ordered list of workflow IDs for sequential execution. */
  workflowOrder?: Array<{ workflowId: string; continueOnFail?: boolean }>;
  /** ID of the workspace this project belongs to. */
  workspaceId?: string;
  /** Workflow IDs attached to this project. */
  workflowIds?: string[];
  /** Default environment ID for this project. */
  environmentId?: string;
  createdAt: string;
  updatedAt: string;
}
