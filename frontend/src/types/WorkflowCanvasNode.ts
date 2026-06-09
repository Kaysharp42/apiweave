export interface WorkflowCanvasNode {
  nodeId?: string;
  id?: string;
  type?: string;
  position: { x: number; y: number };
  label?: string;
  config?: Record<string, unknown>;
  data?: {
    label?: string;
    config?: Record<string, unknown>;
  };
}
