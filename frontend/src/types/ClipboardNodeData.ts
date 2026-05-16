import type { WorkflowNode } from './WorkflowNode';

export interface ClipboardNodeData {
  node: WorkflowNode;
  workflowId: string;
}
