import type { WorkflowCanvasNode } from './WorkflowCanvasNode';
import type { WorkflowCanvasEdge } from './WorkflowCanvasEdge';

export type { WorkflowCanvasNode } from './WorkflowCanvasNode';
export type { WorkflowCanvasEdge } from './WorkflowCanvasEdge';

export interface WorkflowCanvasWorkflow {
  environmentId?: string;
  nodes?: WorkflowCanvasNode[];
  edges?: WorkflowCanvasEdge[];
}
