import type { Workflow } from "./Workflow";
import type { Collection } from "./Collection";
import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface WorkflowItemProps {
  workflow: Workflow;
  isActive: boolean;
  collections: Collection[];
  environments: ScopedEnvironment[];
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
}
