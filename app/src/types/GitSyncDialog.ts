/**
 * The dialog a sync action is waiting on: the manual-mode commit message, the
 * confirmation before local changes are thrown away, or the picker for a merge
 * that stopped on conflicts.
 */
export type GitSyncDialog = "commit" | "discard" | "merge";
