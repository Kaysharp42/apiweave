export interface MoveToProjectDialogProps {
  readonly open: boolean;
  readonly workflowName: string;
  /** The workflow's own workspace — a project anywhere else is not a legal target. */
  readonly workspaceId: string;
  readonly currentProjectId: string | null;
  readonly onClose: () => void;
  /** `null` detaches the workflow from every project. */
  readonly onConfirm: (targetProjectId: string | null) => Promise<void>;
}
