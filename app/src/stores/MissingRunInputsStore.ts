import { create } from "zustand";
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal";

interface MissingRunInputsState {
  /**
   * The refused run on screen, and the agent that asked for it — null when it
   * was the user's own Run.
   */
  shown: { readonly refusal: RunInputsRefusal; readonly agent: string | null } | null;
  show: (refusal: RunInputsRefusal, agent: string | null) => void;
  close: () => void;
}

/**
 * The one "values are missing" dialog for the app. Several paths open it —
 * the canvas checking before its own run, a project run refused, an agent's
 * run refused in main — so it lives here rather than with any of them, and a
 * second refusal replaces the first rather than stacking a dialog on it.
 */
const useMissingRunInputsStore = create<MissingRunInputsState>()((set) => ({
  shown: null,
  show: (refusal, agent) => set({ shown: { refusal, agent } }),
  close: () => set({ shown: null }),
}));

export default useMissingRunInputsStore;
