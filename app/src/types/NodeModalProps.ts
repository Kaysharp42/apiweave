import type { NodeModalNode } from "./NodeModalNode";

export interface NodeModalProps {
  open: boolean;
  node: NodeModalNode;
  onClose: () => void;
  /** Applies the edited node to the canvas. */
  onSave: (node: NodeModalNode) => void;
  /** The canvas's explicit save (Ctrl+S), run after the draft is applied. */
  onSaveWorkflow: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Workspace scope for the Call Workflow target picker. */
  workspaceId: string;
  /** Excluded from the Call Workflow target picker — a workflow can't call itself. */
  currentWorkflowId: string;
}
