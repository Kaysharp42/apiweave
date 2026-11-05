import { useEffect } from "react";
import useNodePresetStore from "../stores/NodePresetStore";

/**
 * Point the shared preset store at one workspace: load its presets on first
 * use and again whenever `workspaceId` changes. While a load for another
 * workspace is in flight this is a no-op, so two surfaces mounting together
 * (the canvas palette and its right-click menu) make one request, not two.
 */
export function useWorkspacePresets(workspaceId: string): void {
  const loadedWorkspaceId = useNodePresetStore(
    (state) => state.loadedWorkspaceId,
  );
  const isLoading = useNodePresetStore((state) => state.isLoading);

  useEffect(() => {
    if (!workspaceId || loadedWorkspaceId === workspaceId || isLoading) {
      return;
    }
    void useNodePresetStore.getState().fetchPresets(workspaceId);
  }, [isLoading, loadedWorkspaceId, workspaceId]);
}
