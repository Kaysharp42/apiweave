export interface CloudWorkspaceBinding {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly cloudWorkspaceId: string;
  readonly cloudWorkspaceName: string;
  readonly teamId?: string;
  readonly teamName?: string;
  readonly syncMode: string;
  readonly initializationState: "pulling" | "pushing" | "initialized";
  readonly pendingCount: number;
  readonly deadLetterCount: number;
  readonly conflictCount: number;
  readonly boundAt: string;
  readonly lastSyncedAt?: string;
  readonly initializedAt?: string;
  readonly lastError?: string;
}
