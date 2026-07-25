import type { VariableProvenance } from "./VariableProvenance";

export interface VariableProvenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  variableName: string;
  provenance: VariableProvenance | null;
}