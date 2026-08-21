export interface MoveToWorkspaceDialogProps {
  readonly open: boolean;
  /** A project move also carries its workflows, which changes the wording. */
  readonly itemKind: "project" | "workflow";
  readonly itemName: string;
  /** The item's own workspace — excluded from the destination choices. */
  readonly currentWorkspaceId: string;
  /**
   * What this move drops, already phrased for the user. Computed by the caller,
   * which is the side that knows the item's current project, environment and
   * Call Workflow targets.
   */
  readonly warnings: readonly string[];
  readonly onClose: () => void;
  /** `targetProjectId` is always null for a project move. */
  readonly onConfirm: (
    targetWorkspaceId: string,
    targetProjectId: string | null,
  ) => Promise<void>;
}
