import type { WorkspacePendingChange } from "@shared/types/WorkspacePendingChange";

/** The commit dialog's list of pending changes: being read, unreadable, or read. */
export type PendingChangesList =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly changes: readonly WorkspacePendingChange[] };
