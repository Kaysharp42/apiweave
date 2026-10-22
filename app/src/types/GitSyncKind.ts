/** Which of the sync control's states a workspace is in; one icon and one label each, so the state never rests on colour alone. */
export type GitSyncKind =
  | "synced"
  | "pending"
  | "syncing"
  | "incoming"
  | "merging"
  | "diverged"
  | "read-only"
  | "error";
