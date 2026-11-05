import { useMemo } from "react";
import useRunStatusStore from "../stores/RunStatusStore";
import { useWorkspaceTabs } from "./useWorkspaceTabs";
import { formatDuration } from "../utils/formatNodeMetrics";
import type { FooterRunPhase, FooterStatus } from "../types";

const LABELS: Readonly<Record<FooterRunPhase, string>> = {
  running: "Running…",
  completed: "Last run passed",
  failed: "Last run failed",
  cancelled: "Last run cancelled",
  interrupted: "Last run interrupted",
};

/**
 * What the status bar should say about the active workflow tab: nothing while
 * that workflow has not run, "Running…" while its run is being played back,
 * and the run's outcome afterwards. The canvas publishes the run's state to
 * `RunStatusStore`; this only translates it for the footer.
 */
export function useFooterStatus(): FooterStatus | null {
  const { activeTab } = useWorkspaceTabs();
  const workflowId = activeTab?.workflowId ?? null;
  const run = useRunStatusStore((state) =>
    workflowId === null ? null : (state.byWorkflow[workflowId] ?? null),
  );

  return useMemo<FooterStatus | null>(() => {
    if (run === null) return null;
    const duration = run.phase === "running" ? null : formatDuration(run.durationMs);
    return {
      phase: run.phase,
      label: duration === null ? LABELS[run.phase] : `${LABELS[run.phase]} · ${duration}`,
    };
  }, [run]);
}

export default useFooterStatus;
