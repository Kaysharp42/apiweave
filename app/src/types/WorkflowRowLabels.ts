import type { getSidebarItemLabel } from "../utils/sidebarItemLabel";

export interface WorkflowRowLabels {
  readonly name: ReturnType<typeof getSidebarItemLabel>;
  /** Null when the workflow is in no project, or its project is not in `collections`. */
  readonly collection: ReturnType<typeof getSidebarItemLabel> | null;
  /** Null when no environment is selected for this workflow. */
  readonly environment: ReturnType<typeof getSidebarItemLabel> | null;
}
