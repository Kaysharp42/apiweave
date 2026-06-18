import type { WorkflowNode } from './WorkflowNode';
import type { WorkflowEdge } from './WorkflowEdge';
import type { Variable } from './Variable';

export interface Workflow {
  workflowId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables?: Variable[];
  createdAt: string;
  updatedAt: string;
  collectionId?: string;
  projectId?: string;
  environmentId?: string;
  swaggerUrl?: string;
  swaggerLastRefreshed?: string;
}
