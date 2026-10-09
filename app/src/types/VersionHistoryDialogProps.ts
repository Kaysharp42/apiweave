export interface VersionHistoryDialogProps {
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly onClose: () => void;
  /** Write the revision back over the workflow; resolves once the canvas shows it. */
  readonly onRestore: (revisionId: string) => Promise<void>;
}
