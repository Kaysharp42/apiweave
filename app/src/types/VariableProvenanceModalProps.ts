import type { VariableProvenance } from "@shared/types/VariableProvenance";

export interface VariableProvenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  variableName: string;
  provenance: VariableProvenance | null;
}
