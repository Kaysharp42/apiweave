import type { Node } from "@xyflow/react";
import type { NodeEditorSteps } from "./NodeEditorSteps";
import type { WorkflowCanvasNodeData } from "./WorkflowCanvasNodeData";

export interface UseNodeEditorWalkResult {
  /** The node the editor shows, or null while it is closed. */
  readonly modalNode: Node<WorkflowCanvasNodeData> | null;
  readonly steps: NodeEditorSteps;
  readonly openNodeEditor: (node: Node<WorkflowCanvasNodeData>) => void;
  /** Closes the editor. Returns the node a walk ended on, when that is not the node it was opened on. */
  readonly closeNodeEditor: () => string | null;
}
