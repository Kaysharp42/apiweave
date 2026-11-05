import { create } from "zustand";
import type { RunStatusState } from "../types";

const useRunStatusStore = create<RunStatusState>()((set) => ({
  byWorkflow: {},

  begin: (workflowId, runId) =>
    set((state) => ({
      byWorkflow: {
        ...state.byWorkflow,
        [workflowId]: { runId, phase: "running", durationMs: null },
      },
    })),

  finish: (workflowId, runId, phase) =>
    set((state) => {
      const current = state.byWorkflow[workflowId];
      // A late terminal event from a superseded run is not this run's news.
      if (current?.runId !== runId) return state;
      return {
        byWorkflow: {
          ...state.byWorkflow,
          [workflowId]: { ...current, phase },
        },
      };
    }),

  setDuration: (workflowId, runId, durationMs) =>
    set((state) => {
      const current = state.byWorkflow[workflowId];
      if (current?.runId !== runId) return state;
      return {
        byWorkflow: {
          ...state.byWorkflow,
          [workflowId]: { ...current, durationMs },
        },
      };
    }),

  forget: (workflowId) =>
    set((state) => {
      if (!(workflowId in state.byWorkflow)) return state;
      const byWorkflow = { ...state.byWorkflow };
      delete byWorkflow[workflowId];
      return { byWorkflow };
    }),
}));

export default useRunStatusStore;
