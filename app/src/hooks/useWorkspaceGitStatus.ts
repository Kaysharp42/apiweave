import { useEffect, useRef, useState } from "react";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { git } from "../utils/apiweaveClient";
import type { GitStatusLoadFailure, WorkspaceGitStatusFeed } from "../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One workspace's git status, loaded once and then followed through
 * `git.onStatusChanged`: the single way the renderer reads it, so the header's
 * sync control and the settings panel cannot disagree about how it is loaded
 * or kept current. Each consumer holds its own subscription — they are two
 * listeners on one bridge, not a shared store.
 *
 * What it returns is always the status of `workspaceId` itself: while the
 * workspace underneath changes, the previous workspace's status is not shown
 * as the new one's — it reads as loading until the new one arrives, and the
 * previous subscription is gone. A status handed to `apply` for any other
 * workspace is dropped, so an action that resolves after a switch cannot
 * overwrite the workspace now shown.
 */
export function useWorkspaceGitStatus(
  workspaceId: string | null,
): WorkspaceGitStatusFeed {
  const available = git.isAvailable();
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [failure, setFailure] = useState<GitStatusLoadFailure | null>(null);
  // What `apply` compares with: a closure from the render an action started in would still name the workspace it started on.
  const currentWorkspaceId = useRef(workspaceId);

  useEffect(() => {
    currentWorkspaceId.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => {
    if (!available || workspaceId === null) return;
    let cancelled = false;
    const unsubscribe = git.onStatusChanged((next) => {
      if (next.workspaceId === workspaceId) setStatus(next);
    });
    git
      .status(workspaceId)
      .then((next) => {
        if (cancelled) return;
        setFailure(null);
        setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure({ workspaceId, message: errorText(error) });
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [available, workspaceId]);

  return {
    status: status?.workspaceId === workspaceId ? status : null,
    error: failure?.workspaceId === workspaceId ? failure.message : null,
    apply: (next) => {
      if (next.workspaceId === currentWorkspaceId.current) setStatus(next);
    },
  };
}
