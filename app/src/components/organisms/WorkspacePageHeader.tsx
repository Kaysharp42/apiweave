import type { ReactNode } from "react";

interface WorkspacePageHeaderProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly orgSlug: string | undefined;
  readonly workspaceSlug: string | undefined;
  /** Shown when the URL carries no slugs. */
  readonly fallbackSubtitle: string;
}

/** The title strip every workspace settings page opens with. */
export function WorkspacePageHeader({
  icon,
  title,
  orgSlug,
  workspaceSlug,
  fallbackSubtitle,
}: WorkspacePageHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
      {icon}
      <div>
        <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
          {title}
        </h1>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {orgSlug && workspaceSlug
            ? `${orgSlug} / ${workspaceSlug}`
            : fallbackSubtitle}
        </p>
      </div>
    </div>
  );
}
