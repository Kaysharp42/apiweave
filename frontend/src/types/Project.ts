/**
 * Project — workspace-scoped grouping of workflows.
 * Maps to the SQLite `collections` table (backend type: `Collection`).
 * The `projectId` field is the public alias for the legacy `collectionId`.
 */
export interface Project {
  /** Internal document ID. */
  id: string;
  /** Legacy collection ID (still used as primary key in DB). */
  collectionId: string;
  /** Public-domain project ID (alias for collectionId). */
  projectId?: string;
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
  /** Whether to continue execution when a workflow fails. */
  continueOnFail?: boolean;
  /** ID of the workspace this project belongs to. */
  workspaceId?: string;
  /** Workflow IDs attached to this project. */
  workflowIds?: string[];
  /** Default environment ID for this project. */
  environmentId?: string;
  createdAt: string;
  updatedAt: string;
}
