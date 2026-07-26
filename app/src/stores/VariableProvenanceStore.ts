import { create } from "zustand";
import type { VariableProvenanceMap } from "../types/VariableProvenanceMap";

interface VariableProvenanceState {
  provenance: VariableProvenanceMap;
  tracingVariable: string | null;
  setProvenance: (next: VariableProvenanceMap) => void;
  setTracingVariable: (name: string | null) => void;
}

/**
 * Canvas provenance, populated by an effect in WorkflowCanvas (which owns the
 * ReactFlow nodes) and read by the Variables panel. Keeps the provenance
 * computation where the graph lives without threading through WorkflowContext.
 */
const useVariableProvenanceStore = create<VariableProvenanceState>((set) => ({
  provenance: {},
  tracingVariable: null,
  setProvenance: (next) => set({ provenance: next }),
  setTracingVariable: (name) => set({ tracingVariable: name }),
}));

export default useVariableProvenanceStore;
