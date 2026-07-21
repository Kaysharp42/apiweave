export interface WorkflowJsonData {
  nodes: Array<{
    nodeId: string;
    type: string;
    label?: string;
    position: { x: number; y: number };
    config?: Record<string, unknown>;
  }>;
  edges: Array<{
    edgeId: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    label?: string | null;
  }>;
  variables: Record<string, unknown>;
}
