import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { onAgentWrite } from "../utils/apiweaveClient";
import { useWorkspace } from "../contexts/WorkspaceContext";
import useSidebarStore from "../stores/SidebarStore";
import useEnvironmentStore from "../stores/EnvironmentStore";
import useNodePresetStore from "../stores/NodePresetStore";
import useAgentWriteRefresh from "./useAgentWriteRefresh";

/**
 * Refetch the shared stores an agent's MCP writes invalidate.
 *
 * Mounted once for the app shell, beside `useAgentRunNotice`, because these
 * stores back surfaces the user can be looking at from any route. Pages that
 * keep their own copy of the same data (the environments page's cross-workspace
 * fan-out, a project page) call {@link useAgentWriteRefresh} for themselves —
 * refreshing a store cannot reach state a component owns.
 *
 * Refetching, not patching: these stores hold whole lists loaded by `useEffect`
 * (there is no query cache to invalidate here), so the honest unit of update is
 * the same fetch the focus handler in `Sidebar.tsx` already runs — which is also
 * why the event needs to carry nothing but a domain. See `AGENT_WRITE_CHANNEL`.
 */
export function useAgentDataUpdates(): void {
  const { refresh: refreshWorkspaces, currentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const workspaceId = currentWorkspace?.workspaceId ?? null;

  useAgentWriteRefresh(["workspaces"], refreshWorkspaces);

  // One signal for both lists: `Sidebar` answers it with
  // `refreshAll(selectedNav)`, which refetches workflows, or projects +
  // workflows, depending on the visible tab. A workflow an agent creates
  // reaches the sidebar only through this — `onWorkflowChanged` is filtered to
  // the workflow the canvas has open.
  useAgentWriteRefresh(["workflows", "assertions", "projects"], () =>
    useSidebarStore.getState().signalWorkflowsRefresh(),
  );
  // `collections` is a separate fetch, owned by `WorkflowContext`.
  useAgentWriteRefresh(["projects"], () =>
    useSidebarStore.getState().signalCollectionsRefresh(),
  );

  useAgentWriteRefresh(["environments"], () => {
    if (workspaceId === null) return;
    void useEnvironmentStore.getState().fetchEnvironments(workspaceId);
  });
  useAgentWriteRefresh(["nodePresets"], () => {
    if (workspaceId === null) return;
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  });

  // Deleting the workspace the user is standing in is the one write no refetch
  // can absorb: every scoped fetch resolves through `currentWorkspace`, so the
  // shell would sit in a permanent loading state. `/app` re-picks a workspace
  // that still exists. Uncoalesced and on its own subscription because it needs
  // the event's `workspaceId`, which a refresh callback never sees.
  const latest = useRef({ workspaceId, refreshWorkspaces, navigate });
  latest.current = { workspaceId, refreshWorkspaces, navigate };
  useEffect(
    () =>
      onAgentWrite((event) => {
        if (event.domain !== "workspaces" || event.action !== "delete") return;
        if (event.workspaceId !== latest.current.workspaceId) return;
        void latest.current.refreshWorkspaces();
        latest.current.navigate("/app", { replace: true });
      }),
    [],
  );
}

export default useAgentDataUpdates;
