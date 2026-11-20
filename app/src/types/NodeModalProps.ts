import type { NodeModalNode } from "./NodeModalNode";
import type { NodeEditorSteps } from "./NodeEditorSteps";

export interface NodeModalProps {
  open: boolean;
  node: NodeModalNode;
  onClose: () => void;
  /** Applies the edited node to the canvas. */
  onSave: (node: NodeModalNode) => void;
  /** The canvas's explicit save (Ctrl+S), run after the draft is applied. */
  onSaveWorkflow: () => void;
  /** Previous/Next. The draft is applied before `onStep` moves the editor. */
  steps: NodeEditorSteps;
  /** Workspace scope for the Call Workflow target picker. */
  workspaceId: string;
  /** Excluded from the Call Workflow target picker — a workflow can't call itself. */
  currentWorkflowId: string;
  /** Another node's result from the last run: what an Assertion node's rules inspected. */
  getNodeOutput: (nodeId: string) => unknown;
}
