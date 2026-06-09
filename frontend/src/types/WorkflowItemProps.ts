import type { Workflow } from './Workflow';
import type { Collection } from './Collection';
import type { Environment } from './Environment';

export interface WorkflowItemProps {
  workflow: Workflow;
  isActive: boolean;
  collections: Collection[];
  environments: Environment[];
  onWorkflowClick: (workflow: Workflow) => void;
  onExportWorkflow: (workflow: Workflow) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
}