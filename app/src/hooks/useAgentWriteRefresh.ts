import { useEffect, useRef } from "react";
import { onAgentWrite } from "../utils/apiweaveClient";

/** Trailing window for a burst of writes — an agent filling a project fires
 * `projects_create` then a dozen `projects_addWorkflow` calls back to back, and
 * refetching once per call would flip a spinner a dozen times. */
const COALESCE_MS = 200;

/**
 * Re-run `refresh` when an agent writes one of `domains` over MCP.
 *
 * Only `WorkflowRepository` announces its own writes, and only to the open
 * canvas — so anything else an agent changes (a workspace, project,
 * environment, node preset) lands underneath a renderer with no observer and no
 * polling. Before this, those surfaces only caught up when the window lost and
 * regained focus.
 *
 * `refresh` is read from a ref, so a caller may pass a fresh closure each
 * render (the usual `useCallback` that closes over the current workspace)
 * without tearing down and re-opening the subscription mid-burst. `domains` is
 * compared by content for the same reason.
 */
export function useAgentWriteRefresh(
  domains: readonly string[],
  refresh: () => void | Promise<void>,
): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const key = domains.join(",");

  useEffect(() => {
    const watched = new Set(key.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onAgentWrite((event) => {
      if (!watched.has(event.domain)) return;
      // A refresh is already scheduled: the rest of the burst rides along.
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void latest.current();
      }, COALESCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [key]);
}

export default useAgentWriteRefresh;
