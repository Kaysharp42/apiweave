/**
 * Where a tracked workspace's sync stands: `error` keeps the failure in
 * `lastError` until the next cycle succeeds, and `diverged` stops the cycle
 * until the histories can be combined (a fast-forward, a discard, or a push
 * that succeeds once the remote has moved back).
 */
export type WorkspaceGitState = "idle" | "syncing" | "merging" | "diverged" | "error"
