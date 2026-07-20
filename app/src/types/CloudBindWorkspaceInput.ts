export interface CloudBindWorkspaceInput {
  readonly workspaceId: string;
  readonly cloudWorkspaceId: string;
  readonly teamId?: string | null;
  readonly syncMode?: "push" | "bi-directional";
}
