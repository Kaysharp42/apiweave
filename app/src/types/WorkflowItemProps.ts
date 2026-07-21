import type { Workflow } from "./Workflow";
import type { Project } from "./Project";
import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface WorkflowItemProps {
  workflow: Workflow;
  isActive: boolean;
  collections: Project[];
  environments: ScopedEnvironment[];
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
}
