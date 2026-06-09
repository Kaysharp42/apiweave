import type { NodeModalNode } from './NodeModalNode';

export interface NodeModalProps {
  open: boolean;
  node: NodeModalNode;
  onClose: () => void;
  onSave: (node: NodeModalNode) => void;
}