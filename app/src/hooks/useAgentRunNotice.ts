import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiweave, onRunStarted } from "../utils/apiweaveClient";
import useTabStore from "../stores/TabStore";
import useWorkspaceTabs from "./useWorkspaceTabs";
import type { Workflow } from "../types/Workflow";

/**
 * Announce a run an agent started on a workflow the user is not looking at.
 *
 * `useWorkflowPolling` adopts a run of the workflow on the canvas and narrates
 * it in full — camera, pacing and all. But only one workflow is on the canvas
 * at a time, and an agent driving the MCP `runs_create` tool is under no
 * obligation to pick that one. Without this, such a run is indistinguishable
 * from nothing happening.
 *
 * A toast with a way in, not an automatic tab switch: yanking the canvas out
 * from under someone mid-edit is worse than the silence it replaces, and the
 * run is still there to be watched a second later. Opening the workflow is
 * enough — the canvas picks the run up on mount (see `useWorkflowPolling`).
 *
 * Mounted once for the app shell. Cross-workspace runs are skipped: the tab
 * store keys tabs by workspace and opening one would mean switching the user's
 * workspace, which is a bigger move than a toast has any business making.
 */
export function useAgentRunNotice(): void {
  const { workspaceId, activeTabId } = useWorkspaceTabs();

  // The subscription must not be torn down and re-opened every time the user
  // switches tabs, so the tab identity is read at event time rather than
  // closed over.
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    if (workspaceId === null) return;
    return onRunStarted((event) => {
      if (event.workspaceId !== workspaceId) return;
      // The canvas has this one; it is already being narrated there.
      if (event.workflowId === activeTabIdRef.current) return;

      // Read the workflow now rather than behind the action: the toast has to
      // name what is running to be worth reading at all, and the same snapshot
      // is what `openTab` wants if the action is taken.
      void (async () => {
        let workflow: Workflow;
        try {
          workflow = (await apiweave.workflows.get(
            workspaceId,
            event.workflowId,
          )) as unknown as Workflow;
        } catch {
          // A run we cannot name is a run we cannot offer to open either.
          return;
        }

        // One toast per workflow, replaced rather than stacked: an agent
        // working through a suite fires these back to back, and a column of
        // them buries whatever else the app was trying to say.
        toast.info(`An agent is running “${workflow.name || "Untitled"}”`, {
          id: `agent-run:${event.workflowId}`,
          action: {
            label: "Show run",
            onClick: () => useTabStore.getState().openTab(workflow),
          },
        });
      })();
    });
  }, [workspaceId]);
}

export default useAgentRunNotice;
