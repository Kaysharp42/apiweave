import type { WorkflowRowLabels } from "./WorkflowRowLabels";

export interface WorkflowItemBadgesProps {
  readonly nodeCount: number;
  readonly labels: WorkflowRowLabels;
  /** A workflow listed under its own project does not need to name that project. */
  readonly hideProject?: boolean;
}
