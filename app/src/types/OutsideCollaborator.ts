/** Outside collaborator on a workspace. */
export interface OutsideCollaborator {
  collaboratorId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  grantedBy: string;
  createdAt: string;
}

/** Workspace-level roles for outside collaborators. */
export type WorkspaceRole = "read" | "triage" | "write" | "maintain" | "admin";
