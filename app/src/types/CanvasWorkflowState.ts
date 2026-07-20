import type { JsonValue } from "@shared/types/JsonValue";
import type { Edge, Node } from "reactflow";
import type { WorkflowCanvasEdgeData } from "./WorkflowCanvasEdgeData";
import type { WorkflowCanvasNodeData } from "./WorkflowCanvasNodeData";

export interface CanvasWorkflowState {
  nodes: Node<WorkflowCanvasNodeData>[];
  edges: Edge<WorkflowCanvasEdgeData>[];
  variables: Record<string, JsonValue>;
  selectedEnvironmentId: string | null;
}
