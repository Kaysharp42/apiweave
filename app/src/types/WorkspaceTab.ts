import type { Workflow } from "./Workflow";

export interface WorkspaceTab {
  id: string;
  workflowId: string;
  name: string;
  workflow?: Workflow;
  isDirty: boolean;
}
