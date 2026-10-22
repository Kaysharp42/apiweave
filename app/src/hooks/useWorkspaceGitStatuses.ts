import { useEffect, useState } from "react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { git } from "../utils/apiweaveClient";

/**
 * Every tracked workspace's git status, loaded once and then followed through
 * `git.onStatusChanged`: the switcher's one subscription for the whole list,
 * where `useWorkspaceGitStatus` subscribes for one workspace at a time. A
 * workspace the list did not know yet arrives with its own status event, and a
 * workspace that is untracked is absent or reports `tracked: false`; either
 * way its row draws no icon.
 *
 * The map is empty with no bridge (the browser build) and stays empty on a
 * failed load: the icons are an addition to the rows, never a reason to show
 * an error where a workspace list should be.
 */
export function useWorkspaceGitStatuses(): ReadonlyMap<string, WorkspaceGitStatus> {
  const available = git.isAvailable();
  const [statuses, setStatuses] = useState<ReadonlyMap<string, WorkspaceGitStatus>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const remember = (status: WorkspaceGitStatus): void =>
      setStatuses((current) => new Map(current).set(status.workspaceId, status));
    const unsubscribe = git.onStatusChanged(remember);
    git
      .statusAll()
      .then((all) => {
        if (cancelled) return;
        setStatuses((current) => {
          const next = new Map(all.map((status) => [status.workspaceId, status] as const));
          // A status pushed while the list was being read is newer than the list.
          for (const [workspaceId, status] of current) next.set(workspaceId, status);
          return next;
        });
      })
      .catch(() => {
        // The rows keep whatever they already had; the switcher itself is unaffected.
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [available]);

  return statuses;
}
