/**
 * The sync vocabulary of the plan's §4.1 table: what a workspace's history is
 * doing, coarse enough to show in the header, the switcher and Version history
 * alike. The view built from it still names the exact state — "Merge needed",
 * not "Attention" — but every surface colours and iconises it by this kind.
 */
export type GitSyncKind =
  | "untracked"
  | "local"
  | "synced"
  | "pending"
  | "syncing"
  | "attention"
  | "error";
