export interface WorkflowItemProps {
  workflow: {
    workflowId: string;
    name: string;
    description?: string;
    nodes?: Array<Record<string, unknown>>;
    collectionId?: string;
  };
  isActive: boolean;
  collections: Array<{ collectionId: string; name: string }>;
  environments: Array<{ environmentId: string; name: string }>;
  onWorkflowClick: (workflow: WorkflowItemProps['workflow']) => void;
  onExportWorkflow: (workflow: WorkflowItemProps['workflow']) => void;
  onDeleteWorkflow: (workflowId: string, name: string) => void;
}
