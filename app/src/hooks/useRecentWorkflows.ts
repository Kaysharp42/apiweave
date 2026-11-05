import { useEffect, useState } from "react";
import type { RecentWorkflow, WorkspaceTab } from "../types";
import { apiweave } from "../utils/apiweaveClient";
import { getLogger } from "../utils/logger";

const workspaceLog = getLogger("Workspace");

/**
 * The workspace's five most recently updated workflows, for the launch screen.
 *
 * The launch screen is the one place a workflow is opened without the sidebar
 * mounted (or on a nav section that does not list every workflow), so it reads
 * the workspace's full list once — and only while no tab is open.
 */
export function useRecentWorkflows(
  activeTab: WorkspaceTab | undefined,
  isScopeReady: boolean,
  workspaceId: string | null,
): RecentWorkflow[] {
  const [recentWorkflows, setRecentWorkflows] = useState<RecentWorkflow[]>([]);

  useEffect(() => {
    if (activeTab || !isScopeReady || !workspaceId) return;

    let cancelled = false;
    const loadRecent = async (): Promise<void> => {
      try {
        const { items } = await apiweave.workflows.list(workspaceId, true);
        if (cancelled) return;
        setRecentWorkflows(
          [...items]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5)
            .map(({ workflowId, name, updatedAt }) => ({
              workflowId,
              name,
              updatedAt,
            })),
        );
      } catch (error) {
        if (!cancelled) {
          workspaceLog.error("Error fetching recent workflows:", error);
        }
      }
    };

    void loadRecent();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isScopeReady, workspaceId]);

  return recentWorkflows;
}
