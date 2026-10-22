/** A workspace an open created, with the import warnings the dialog shows before switching to it. */
export interface PendingWorkspaceOpen {
  slug: string;
  name: string;
  warnings: readonly string[];
}
