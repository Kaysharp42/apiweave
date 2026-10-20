export interface GitCommitDialogProps {
  readonly workspaceId: string;
  /** Whether the commit is also pushed: only the wording differs. */
  readonly connected: boolean;
  readonly onClose: () => void;
  /** The message as typed, possibly empty. */
  readonly onConfirm: (message: string) => void;
}
