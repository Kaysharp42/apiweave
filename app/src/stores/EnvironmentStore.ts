import { create } from "zustand";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";
import { authenticatedFetch } from "../utils/apiweaveClient";
import * as scopedApi from "../utils/apiweaveClient";

interface EnvironmentState {
  environments: ScopedEnvironment[];
  /**
   * The workspace `environments` holds. An environment belongs to exactly one
   * workspace, so this is what makes the list interpretable: without it nothing
   * can tell a loaded-and-empty workspace from one still in flight, and a slow
   * response for a workspace the user has since left cannot be recognised and
   * dropped.
   */
  loadedWorkspaceId: string | null;
  selectedEnvironmentByWorkflow: Record<string, string | null>;
  isLoading: boolean;

  fetchEnvironments: (workspaceId: string) => Promise<void>;
  setSelectedEnv: (workflowId: string, envId: string) => void;
  clearSelectedEnv: (workflowId: string) => void;
  setDefaultEnv: (envId: string) => void;
}

function normalizeScopedEnvironment(
  raw: Partial<ScopedEnvironment>,
): ScopedEnvironment {
  const env: ScopedEnvironment = {
    environmentId: raw.environmentId ?? "",
    name: raw.name ?? "",
    variables: (raw.variables ?? {}) as Record<string, string>,
    secrets: raw.secrets ?? {},
    scopeType: raw.scopeType ?? "workspace",
    scopeId: raw.scopeId ?? "",
    isDefault: raw.isDefault ?? false,
    allowedWorkspaceIds: raw.allowedWorkspaceIds ?? [],
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
  if (raw.description !== undefined) env.description = raw.description;
  if (raw.swaggerDocUrl !== undefined) env.swaggerDocUrl = raw.swaggerDocUrl;
  if (raw.baseEnvironmentId !== undefined)
    env.baseEnvironmentId = raw.baseEnvironmentId;
  if (raw.ownerType !== undefined) env.ownerType = raw.ownerType;
  return env;
}

/** Accept both the bare-array and the enveloped `{ environments, total }` payload. */
function parseEnvironmentList(
  payload: ScopedEnvironment[] | { environments?: ScopedEnvironment[] },
): ScopedEnvironment[] {
  const rawList = Array.isArray(payload) ? payload : (payload.environments ?? []);
  return rawList.map(normalizeScopedEnvironment);
}

const useEnvironmentStore = create<EnvironmentState>()((set, _get) => ({
  environments: [],
  loadedWorkspaceId: null,
  selectedEnvironmentByWorkflow: {},
  isLoading: false,

  /**
   * Load the environments of exactly ONE workspace, replacing whatever was here.
   *
   * The clear happens BEFORE the await, and a failed request leaves the list
   * empty rather than restoring what was there. Environments are not a
   * stale-but-harmless cache: one belongs to a single workspace, so anything left
   * over after a switch shows up in the run-time environment picker, and picking
   * it saves a `selectedEnvironmentId` the server rejects as `not_found` — the
   * workspace the user is now in has no such environment. An empty picker is the
   * honest state.
   */
  fetchEnvironments: async (workspaceId: string) => {
    set({
      environments: [],
      loadedWorkspaceId: workspaceId || null,
      isLoading: Boolean(workspaceId),
    });
    if (!workspaceId) return;

    try {
      const response = await authenticatedFetch(
        scopedApi.environmentsUrl(workspaceId),
      );
      // Sidebar, MainLayout and the environments page all drive this, so two
      // loads can be in flight at once. A response for a workspace we have since
      // switched away from must not install itself over the current one —
      // checked before the body is read and again after it is parsed.
      if (_get().loadedWorkspaceId !== workspaceId || !response.ok) return;
      const environments = parseEnvironmentList(
        (await response.json()) as
          | ScopedEnvironment[]
          | { environments?: ScopedEnvironment[] },
      );
      if (_get().loadedWorkspaceId !== workspaceId) return;
      set({ environments });
    } catch {
      /* silent — the list stays empty, which is the safe reading */
    } finally {
      if (_get().loadedWorkspaceId === workspaceId) set({ isLoading: false });
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

  setDefaultEnv: (envId: string) => {
    localStorage.setItem("defaultEnvironment", envId);
  },
}));

/**
 * Selector: resolves the effective environment ID for a workflow.
 * Fallback chain:
 * 1. selectedEnvironmentByWorkflow[workflowId] if defined (not undefined)
 * 2. workflowEnvironmentId if provided
 * 3. localStorage.getItem('defaultEnvironment') if it names an environment in
 *    the current workspace
 * 4. null
 *
 * The localStorage default outlives workspace switches and environment
 * deletions, so it is only trusted when the current workspace still has that
 * environment; otherwise a new workflow would save a dangling
 * `selectedEnvironmentId` and be rejected as not_found.
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
  if (
    globalDefault &&
    state.environments.some((env) => env.environmentId === globalDefault)
  ) {
    return globalDefault;
  }
  return null;
}

export default useEnvironmentStore;
