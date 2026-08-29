import { ChevronRight, Layers } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { EmptyState } from "../molecules/EmptyState";
import { ScopedSecretList } from "../ScopedSecretList";
import type { Secret, WorkspaceOption } from "../../types";

/** A secret plus the workspace whose scope holds it — the pair every action needs. */
export interface SecretTarget {
  readonly secret: Secret;
  readonly workspaceId: string;
}

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
 *
 * `<details>` does the collapsing — open by default, remembers nothing, which is
 * right for a list this short and saves an accordion's worth of state.
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
  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={
          <Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />
        }
        title="No workspaces"
        description="Create a workspace before adding secrets to it."
      />
    );
  }

  return (
    <div className="space-y-3">
      {workspaces.map((workspace) => {
        const isActive = workspace.workspaceId === activeWorkspaceId;
        return (
          <details
            key={workspace.workspaceId}
            open
            className="group/ws rounded border border-border dark:border-border-dark"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay">
              <ChevronRight
                className="w-4 h-4 flex-shrink-0 text-text-muted transition-transform group-open/ws:rotate-90"
                aria-hidden="true"
              />
              <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
                {workspace.name}
              </span>
              {isActive && (
                <Badge variant="primary" size="xs">
                  Active
                </Badge>
              )}
            </summary>

            <div className="p-3">
              <ScopedSecretList
                key={`${workspace.workspaceId}:${refreshKey}`}
                scopeType="workspace"
                scopeId={workspace.workspaceId}
                readOnly={!isActive}
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
            </div>
          </details>
        );
      })}
    </div>
  );
}
