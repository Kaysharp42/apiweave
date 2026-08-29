import { ScopedEnvironmentList } from "./ScopedEnvironmentList";
import { WorkspaceGroupList } from "./WorkspaceGroupSection";
import type { ScopedEnvironment, WorkspaceEnvironmentGroup } from "../../types";

interface WorkspaceEnvironmentGroupsProps {
  readonly groups: readonly WorkspaceEnvironmentGroup[];
  /** The workspace the user is currently in — the only one that can be edited here. */
  readonly activeWorkspaceId: string;
  readonly selectedId?: string | undefined;
  readonly onSelect: (env: ScopedEnvironment, workspaceId: string) => void;
  readonly onCreate: () => void;
  readonly onEdit: (env: ScopedEnvironment) => void;
  readonly onDelete: (env: ScopedEnvironment) => void;
  readonly onDuplicate: (env: ScopedEnvironment, workspaceId: string) => void;
  readonly onMove: (env: ScopedEnvironment, workspaceId: string) => void;
}

/**
 * Every workspace, each with the environments that belong to it.
 *
 * An environment belongs to exactly one workspace and cannot be selected for a
 * run from any other — that rule is enforced in the store, the service and the
 * sync envelope. This page is where that rule becomes visible: grouping by
 * workspace is the whole point, so a name can appear twice without it being a
 * duplicate, and so it is obvious which "Staging" is about to run.
 *
 * Only the active workspace's environments can be edited or deleted here.
 * Everything else is listed so the user can see where it lives and copy or move
 * it, which are the two operations that legitimately cross the border.
 */
export function WorkspaceEnvironmentGroups({
  groups,
  activeWorkspaceId,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
}: WorkspaceEnvironmentGroupsProps) {
  return (
    <WorkspaceGroupList
      activeWorkspaceId={activeWorkspaceId}
      emptyDescription="Create a workspace before adding environments to it."
      groups={groups.map((group) => {
        const isActive = group.workspaceId === activeWorkspaceId;
        return {
          workspaceId: group.workspaceId,
          name: group.name,
          summaryEnd: `${group.environments.length} env${
            group.environments.length === 1 ? "" : "s"
          }`,
          content: (
            <ScopedEnvironmentList
              environments={group.environments}
              scopeType="workspace"
              title={
                isActive
                  ? "Editable here"
                  : `In ${group.name} — copy or move only`
              }
              readOnly={!isActive}
              onSelect={(env) => onSelect(env, group.workspaceId)}
              {...(isActive ? { onCreate } : {})}
              onEdit={onEdit}
              onDelete={onDelete}
              onDuplicate={(env) => onDuplicate(env, group.workspaceId)}
              onMove={(env) => onMove(env, group.workspaceId)}
              selectedId={selectedId}
            />
          ),
        };
      })}
    />
  );
}
