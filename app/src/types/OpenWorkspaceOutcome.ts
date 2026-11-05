import type { ExistingWorkspace } from "./ExistingWorkspace";
import type { PendingWorkspaceOpen } from "./PendingWorkspaceOpen";

/**
 * What the open-from-git dialog is showing once the clone returns: the form
 * itself, the workspace that was already here, or the one it opened with
 * warnings still to review.
 */
export type OpenWorkspaceOutcome =
  | { readonly kind: "form" }
  | { readonly kind: "duplicate"; readonly workspace: ExistingWorkspace }
  | { readonly kind: "pending"; readonly workspace: PendingWorkspaceOpen };
