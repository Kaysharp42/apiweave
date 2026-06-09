export interface WorkflowCanvasEdge {
  edgeId?: string;
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string | null;
}
