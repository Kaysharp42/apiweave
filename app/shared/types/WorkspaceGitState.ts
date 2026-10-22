/** Where a tracked workspace's sync stands: `error` keeps the failure in `lastError` until the next cycle succeeds. */
export type WorkspaceGitState = "idle" | "syncing" | "merging" | "error"
