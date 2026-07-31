import type { NodeModalNode } from "./NodeModalNode";

export interface NodeModalProps {
  open: boolean;
  node: NodeModalNode;
  onClose: () => void;
  onSave: (node: NodeModalNode) => void;
  /** Workspace scope for the Call Workflow target picker. */
  workspaceId: string;
  /** Excluded from the Call Workflow target picker — a workflow can't call itself. */
  currentWorkflowId: string;
}
