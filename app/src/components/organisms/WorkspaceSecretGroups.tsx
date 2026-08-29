import { ScopedSecretList } from "../ScopedSecretList";
import { WorkspaceGroupList } from "./WorkspaceGroupSection";
import type { Secret, SecretTarget, WorkspaceOption } from "../../types";

interface WorkspaceSecretGroupsProps {
  readonly workspaces: readonly WorkspaceOption[];
  /** The workspace the user is currently in — the only one that can be edited here. */
  readonly activeWorkspaceId: string;
  /** Bumped by the page to force every group to refetch after a copy or move. */
  readonly refreshKey: number;
  readonly selectedId?: string | undefined;
  readonly onSelect: (secret: Secret, workspaceId: string) => void;
  readonly onChanged: () => void;
  readonly onDuplicate: (target: SecretTarget) => void;
  readonly onMove: (target: SecretTarget) => void;
}

/**
 * Every workspace, each with the secrets stored under its own workspace scope.
 *
 * Each group fetches its own list, so the per-workspace authorization boundary
 * stays in the read path — there is no list-every-secret call to add, and each
 * group's `scopeId` IS its workspace id, which is what the service authorizes
 * against. Environment-scoped secrets are not shown here: they live with their
 * environment and are edited there.
 *
 * Only the active workspace's secrets can be deleted from this page. The rest
 * are listed so the user can see where a name lives and copy or move it, which
 * are the two operations that legitimately cross the border.
 */
export function WorkspaceSecretGroups({
  workspaces,
  activeWorkspaceId,
  refreshKey,
  selectedId,
  onSelect,
  onChanged,
  onDuplicate,
  onMove,
}: WorkspaceSecretGroupsProps) {
  return (
    <WorkspaceGroupList
      activeWorkspaceId={activeWorkspaceId}
      emptyDescription="Create a workspace before adding secrets to it."
      groups={workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        content: (
          <ScopedSecretList
            key={`${workspace.workspaceId}:${refreshKey}`}
            scopeType="workspace"
            scopeId={workspace.workspaceId}
            readOnly={workspace.workspaceId !== activeWorkspaceId}
            onChanged={onChanged}
            onSelect={(secret) => onSelect(secret, workspace.workspaceId)}
            onDuplicate={(secret) =>
              onDuplicate({ secret, workspaceId: workspace.workspaceId })
            }
            onMove={(secret) =>
              onMove({ secret, workspaceId: workspace.workspaceId })
            }
            {...(selectedId ? { selectedId } : {})}
          />
        ),
      }))}
    />
  );
}
