import type { Project } from "../types/Project";

/**
 * True when a project row may be shown under `workspaceId`.
 *
 * The sidebar store clears its lists in an effect, one commit after the route
 * changes the workspace — so for that one commit the store still holds the
 * previous workspace's rows while every route-derived id is already the new
 * workspace's. Filtering during render rather than trusting the post-commit
 * clear is what keeps a row from pairing the new workspace with the old
 * workspace's project — the pairing that made `agents:resolveLocalPath` fail
 * with "project not found" on every workspace switch. (See `useWorkspaceTabs`
 * for the same fix applied to the open tabs.)
 *
 * A project with no `workspaceId` passes: the API always sends one, so a
 * missing field means a locally built object that cannot be proved foreign,
 * and hiding it would break every synthetic caller for no real case.
 */
export function projectInWorkspace(
  project: Project,
  workspaceId: string | null,
): boolean {
  return (
    project.workspaceId === undefined || project.workspaceId === workspaceId
  );
}
