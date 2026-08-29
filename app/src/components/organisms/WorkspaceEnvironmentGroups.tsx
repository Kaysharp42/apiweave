import { ChevronRight, Layers } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { EmptyState } from "../molecules/EmptyState";
import { ScopedEnvironmentList } from "./ScopedEnvironmentList";
import type { ScopedEnvironment } from "../../types";

export interface WorkspaceEnvironmentGroup {
  readonly workspaceId: string;
  readonly name: string;
  readonly environments: ScopedEnvironment[];
}

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
 *
 * `<details>` does the collapsing. It is open by default and remembers nothing,
 * which is right for a list this short and saves an accordion's worth of state.
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
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={
          <Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />
        }
        title="No workspaces"
        description="Create a workspace before adding environments to it."
      />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isActive = group.workspaceId === activeWorkspaceId;
        return (
          <details
            key={group.workspaceId}
            open
            className="group/ws rounded border border-border dark:border-border-dark"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay">
              <ChevronRight
                className="w-4 h-4 flex-shrink-0 text-text-muted transition-transform group-open/ws:rotate-90"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
                {group.name}
              </span>
              {isActive && (
                <Badge variant="primary" size="xs">
                  Active
                </Badge>
              )}
              <span className="ml-auto text-xs text-text-muted dark:text-text-muted-dark">
                {group.environments.length} env
                {group.environments.length === 1 ? "" : "s"}
              </span>
            </summary>

            <div className="p-3">
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
            </div>
          </details>
        );
      })}
    </div>
  );
}
