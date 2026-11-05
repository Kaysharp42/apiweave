export interface WorkflowRowLabels {
  readonly name: string;
  /** Null when the workflow is in no project, or its project is not in `collections`. */
  readonly collection: string | null;
  /** Null when no environment is selected for this workflow. */
  readonly environment: string | null;
}
