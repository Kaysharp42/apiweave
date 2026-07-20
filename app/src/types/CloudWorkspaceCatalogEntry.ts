export interface CloudWorkspaceCatalogEntry {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly isPersonal: boolean;
  readonly effectiveRole: number;
  readonly canPull: boolean;
  readonly canPush: boolean;
  readonly canResolveConflicts: boolean;
}
