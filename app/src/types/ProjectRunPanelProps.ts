export interface ProjectRunPanelProps {
  workspaceId: string;
  projectId: string;
  /** Show one workflow's run from a project run (its canvas, History open on that run). */
  onOpenRun: (workflowId: string, runId: string) => void;
}
