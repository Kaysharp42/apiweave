/**
 * How a tracked workspace's edits become commits: `auto` commits about 30 s
 * after the last edit, `manual` only when the user asks.
 */
export type WorkspaceGitMode = "auto" | "manual"

/** Narrows an arbitrary value (an IPC argument, a stored column) back to a mode. */
export function isWorkspaceGitMode(value: unknown): value is WorkspaceGitMode {
  return value === "auto" || value === "manual"
}
