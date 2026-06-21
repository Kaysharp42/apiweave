import { create } from "zustand";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import { authenticatedFetch } from "../utils/authenticatedApi";
import * as scopedApi from "../utils/scopedApi";

interface EnvironmentState {
  environments: ScopedEnvironment[];
  selectedEnvironmentByWorkflow: Record<string, string | null>;
  environmentVersion: number;
  isLoading: boolean;

  fetchEnvironments: (workspaceId: string) => Promise<void>;
  setSelectedEnv: (workflowId: string, envId: string) => void;
  clearSelectedEnv: (workflowId: string) => void;
  signalRefresh: () => void;
  setDefaultEnv: (envId: string) => void;
}

const useEnvironmentStore = create<EnvironmentState>()((set, _get) => ({
  environments: [],
  selectedEnvironmentByWorkflow: {},
  environmentVersion: 0,
  isLoading: false,

  fetchEnvironments: async (workspaceId: string) => {
    if (!workspaceId) {
      set({ environments: [], isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      const response = await authenticatedFetch(
        scopedApi.environmentsUrl(workspaceId, "all-accessible"),
      );
      if (response.ok) {
        const data: ScopedEnvironment[] = await response.json();
        set({ environments: data });
      }
    } catch {
      /* silent */
    } finally {
      set({ isLoading: false });
    }
  },

  setSelectedEnv: (workflowId: string, envId: string) =>
    set((s) => ({
      selectedEnvironmentByWorkflow: {
        ...s.selectedEnvironmentByWorkflow,
        [workflowId]: envId,
      },
    })),

  clearSelectedEnv: (workflowId: string) =>
    set((s) => ({
      selectedEnvironmentByWorkflow: {
        ...s.selectedEnvironmentByWorkflow,
        [workflowId]: null,
      },
    })),

  signalRefresh: () =>
    set((s) => ({ environmentVersion: s.environmentVersion + 1 })),

  setDefaultEnv: (envId: string) => {
    localStorage.setItem("defaultEnvironment", envId);
  },
}));

/**
 * Selector: resolves the effective environment ID for a workflow.
 * Fallback chain:
 * 1. selectedEnvironmentByWorkflow[workflowId] if defined (not undefined)
 * 2. workflowEnvironmentId if provided
 * 3. localStorage.getItem('defaultEnvironment') if present
 * 4. null
 */
export function getSelectedEnvironment(
  workflowId: string,
  workflowEnvironmentId?: string,
): string | null {
  const state = useEnvironmentStore.getState();
  const workflowSpecific = state.selectedEnvironmentByWorkflow[workflowId];
  if (workflowSpecific !== undefined) {
    return workflowSpecific;
  }
  if (workflowEnvironmentId) {
    return workflowEnvironmentId;
  }
  const globalDefault = localStorage.getItem("defaultEnvironment");
  if (globalDefault) {
    return globalDefault;
  }
  return null;
}

export default useEnvironmentStore;
