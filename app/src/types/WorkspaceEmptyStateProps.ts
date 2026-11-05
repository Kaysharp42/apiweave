import type { RecentWorkflow } from "./RecentWorkflow";

export interface WorkspaceEmptyStateProps {
  onNewWorkflow?: () => void;
  onImport?: () => void;
  onOpenCollection?: () => void;
  onOpenFromGit?: () => void;
  onOpenTutorials?: () => void;
  /** "Start tutorial" on first run, "Continue tutorial" once progress exists. */
  tutorialsLabel?: string;
  /** Most recently updated workflows, newest first. */
  recentWorkflows?: readonly RecentWorkflow[];
  onOpenWorkflow?: (workflow: RecentWorkflow) => void;
}
