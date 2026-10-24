import { useWorkspace } from "../contexts/WorkspaceContext";
import { gitAccountKey } from "../utils/gitAccounts";
import { useWorkspaceGitStatuses } from "./useWorkspaceGitStatuses";

/**
 * The names of the workspaces that sync as each account, keyed by
 * `gitAccountKey`: every tracked workspace's status, as the switcher reads
 * it, matched to the app's workspace list for names. A workspace with no
 * account is in no entry.
 */
export function useGitAccountWorkspaces(): ReadonlyMap<string, readonly string[]> {
  const statuses = useWorkspaceGitStatuses();
  const { availableWorkspaces } = useWorkspace();
  const names = new Map(availableWorkspaces.map((workspace) => [workspace.workspaceId, workspace.name] as const));
  const usedBy = new Map<string, string[]>();
  for (const status of statuses.values()) {
    const name = names.get(status.workspaceId);
    if (!status.tracked || status.account === null || name === undefined) continue;
    const key = gitAccountKey(status.account);
    usedBy.set(key, [...(usedBy.get(key) ?? []), name]);
  }
  return usedBy;
}
