import type { ReactNode } from "react";
import { ChevronRight, Layers } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { EmptyState } from "../molecules/EmptyState";

interface WorkspaceGroupSectionProps {
  /** The workspace this group renders — also the stable key. */
  readonly workspaceId: string;
  readonly name: string;
  /** The workspace the user is currently in is the only fully editable one. */
  readonly isActive: boolean;
  /** Right-aligned muted summary text, e.g. a row count. */
  readonly summaryEnd?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The collapsible per-workspace section both settings lists render.
 *
 * `<details>` does the collapsing. It is open by default and remembers nothing,
 * which is right for a list this short and saves an accordion's worth of state.
 */
export function WorkspaceGroupSection({
  workspaceId,
  name,
  isActive,
  summaryEnd,
  children,
}: WorkspaceGroupSectionProps) {
  return (
    <details
      key={workspaceId}
      open
      className="group/ws rounded border border-border dark:border-border-dark"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay">
        <ChevronRight
          className="w-4 h-4 flex-shrink-0 text-text-muted transition-transform group-open/ws:rotate-90"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
          {name}
        </span>
        {isActive && (
          <Badge variant="primary" size="xs">
            Active
          </Badge>
        )}
        {summaryEnd && (
          <span className="ml-auto text-xs text-text-muted dark:text-text-muted-dark">
            {summaryEnd}
          </span>
        )}
      </summary>

      <div className="p-3">{children}</div>
    </details>
  );
}

/** One workspace's entry in {@link WorkspaceGroupList}. */
interface WorkspaceGroupEntry {
  readonly workspaceId: string;
  readonly name: string;
  /** Right-aligned muted summary text, e.g. a row count. */
  readonly summaryEnd?: ReactNode;
  /** What the group's collapsible body renders. */
  readonly content: ReactNode;
}

interface WorkspaceGroupListProps {
  readonly groups: readonly WorkspaceGroupEntry[];
  /** The workspace the user is currently in — the only one marked Active. */
  readonly activeWorkspaceId: string;
  /** The empty-state text, which names what belongs in a workspace. */
  readonly emptyDescription: string;
}

/**
 * The list every workspace-settings page renders: one collapsible section per
 * workspace, or the no-workspaces prompt when there is nothing to group yet.
 */
export function WorkspaceGroupList({
  groups,
  activeWorkspaceId,
  emptyDescription,
}: WorkspaceGroupListProps) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />}
        title="No workspaces"
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <WorkspaceGroupSection
          key={group.workspaceId}
          workspaceId={group.workspaceId}
          name={group.name}
          isActive={group.workspaceId === activeWorkspaceId}
          summaryEnd={group.summaryEnd}
        >
          {group.content}
        </WorkspaceGroupSection>
      ))}
    </div>
  );
}
