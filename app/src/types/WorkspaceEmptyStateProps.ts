export interface WorkspaceEmptyStateProps {
  onNewWorkflow?: () => void;
  onImport?: () => void;
  onOpenCollection?: () => void;
  onOpenTutorials?: () => void;
  /** "Start tutorial" on first run, "Continue tutorial" once progress exists. */
  tutorialsLabel?: string;
}
