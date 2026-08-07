import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiweave, onCloudStatusChanged } from "../utils/apiweaveClient";
import useSidebarStore from "../stores/SidebarStore";
import useTabStore from "../stores/TabStore";

/**
 * Clears session-scoped UI state when the linked cloud account changes.
 *
 * Workspace data refreshes itself on the cloud-status signal, but open tabs,
 * the active workspace, the current route and the default-environment
 * preference all point at the previous account's records and survive the
 * switch — which is why disconnecting used to require an app restart before
 * the UI stopped showing the old account's workflows.
 *
 * Only UI state is touched here. Nothing in the database is deleted: that is
 * decided in the main process by the disconnect the user confirmed.
 *
 * Mount once, inside the router.
 */
export function useAccountSessionReset(): void {
  const navigate = useNavigate();
  // undefined = not yet observed, so the first status read only records the
  // baseline. null = no account linked.
  const previousAccountRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      let accountId: string | null;
      try {
        const status = await apiweave.cloud.status();
        accountId = status.account?.accountId ?? null;
      } catch {
        // Cloud sync is unavailable (web preview, or the bridge is missing).
        // Nothing to track, and never a reason to disturb the session.
        return;
      }
      if (cancelled) return;

      const previous = previousAccountRef.current;
      previousAccountRef.current = accountId;
      if (previous === undefined || previous === accountId) {
        return;
      }

      useTabStore.getState().closeAll();
      useSidebarStore.getState().setActiveWorkspaceId(null);
      try {
        localStorage.removeItem("defaultEnvironment");
      } catch {
        // A blocked storage backend must not stop the rest of the reset.
      }
      // The route still names the previous account's workspace slug; /app
      // re-resolves to a workspace that exists now.
      navigate("/app", { replace: true });
    };

    void check();
    const unsubscribe = onCloudStatusChanged(() => {
      void check();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [navigate]);
}

export default useAccountSessionReset;
