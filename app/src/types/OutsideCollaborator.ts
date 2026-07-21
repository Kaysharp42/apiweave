import type { WorkspaceRole } from "./WorkspaceRole";

export type { WorkspaceRole } from "./WorkspaceRole";

/** Outside collaborator on a workspace. */
export interface OutsideCollaborator {
  collaboratorId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  grantedBy: string;
  createdAt: string;
}
