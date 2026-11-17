import { useCallback, useEffect, useState } from "react";
import type { UseAgentCreatedWorkspaceResult } from "../types/UseAgentCreatedWorkspaceResult";
import type { Workspace } from "../types/Workspace";
import { apiweave, git, onAgentWrite } from "../utils/apiweaveClient";

/**
 * The workspaces agents create, one at a time, for the app to ask the user
 * about. Only in the desktop app, where git is; a workspace opened from a
 * repository arrives as `gitImport`, not `create`, and is never asked about.
 * One deleted before its turn is skipped.
 */
export function useAgentCreatedWorkspace(): UseAgentCreatedWorkspaceResult {
  // Not asked about yet, oldest first.
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const current = queue[0] ?? null;

  useEffect(
    () =>
      onAgentWrite((event) => {
        const created = event.workspaceId;
        if (event.domain !== "workspaces" || event.action !== "create" || created === undefined || !git.isAvailable()) return;
        setQueue((waiting) => (waiting.includes(created) ? waiting : [...waiting, created]));
      }),
    [],
  );

  const dismiss = useCallback(() => {
    setWorkspace(null);
    setQueue((waiting) => waiting.slice(1));
  }, []);

  useEffect(() => {
    if (current === null) return;
    let live = true;
    apiweave.workspaces.get(current).then(
      (found) => {
        if (live) setWorkspace(found);
      },
      () => {
        if (live) dismiss();
      },
    );
    return () => {
      live = false;
    };
  }, [current, dismiss]);

  return { workspace, dismiss };
}
