import type { Workflow } from "./Workflow";

export interface WorkspaceWorkflowListResponse {
  workflows: Workflow[];
  total: number;
}
