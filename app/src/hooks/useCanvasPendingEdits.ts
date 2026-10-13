import { useEffect, useRef } from "react";
import useTabStore from "../stores/TabStore";
import { registerPendingEdits } from "../stores/PendingEditsStore";
import { canvasToWorkflow } from "../adapters/workflowCanvas";
import { canvasDiffersFromWorkflow } from "./useWorkflowLiveUpdates";
import { getLogger } from "../utils/logger";
import type { CanvasPendingEditsParams } from "../types/CanvasPendingEditsParams";

const log = getLogger("CanvasPendingEdits");

/**
 * Keeps the mounted canvas's unsaved work from being thrown away.
 *
 * While mounted, closing its tab or quitting asks here first: a pending
 * auto-save goes out, and anything still unsaved is put to the user. Compared
 * against the tab's workflow, which every successful save and applied
 * snapshot refreshes.
 *
 * On unmount — a switch to another tab or workspace — what is still unsaved
 * is stashed on the tab as a draft, which the canvas hydrates from when the
 * tab is shown again. A pending auto-save sent by that same unmount clears the
 * draft once it lands.
 */
export default function useCanvasPendingEdits(
  params: CanvasPendingEditsParams,
): void {
  const latest = useRef(params);
  latest.current = params;
  const { workflowId } = params;

  useEffect(() => {
    if (!workflowId) return;
    const savedWorkflow = () =>
      useTabStore.getState().tabs.find((t) => t.id === workflowId)?.workflow;
    const isUnsaved = (): boolean => {
      const saved = savedWorkflow();
      if (!latest.current.isHydrated || !saved) return false;
      const { nodes, edges, variables } = latest.current.readCanvas();
      return canvasDiffersFromWorkflow(nodes, edges, variables, saved);
    };

    const unregister = registerPendingEdits(workflowId, {
      flush: () => latest.current.flush(),
      save: () => latest.current.save(),
      isUnsaved,
    });

    return () => {
      unregister();
      // Not shown yet: whatever draft the tab already holds is still current.
      if (!latest.current.isHydrated) return;
      // No saved workflow: the tab is gone (closed) or never loaded.
      const saved = savedWorkflow();
      if (!saved) return;
      const { stashDraft } = useTabStore.getState();
      if (!isUnsaved()) {
        stashDraft(workflowId, null);
        return;
      }
      try {
        stashDraft(
          workflowId,
          canvasToWorkflow(
            {
              ...latest.current.readCanvas(),
              selectedEnvironmentId: saved.selectedEnvironmentId ?? null,
            },
            saved,
          ),
        );
      } catch (error) {
        // A canvas that does not serialise cannot be saved either; there is
        // nothing valid to keep.
        log.error("draft-not-kept", { workflowId, error });
      }
    };
  }, [workflowId]);
}
