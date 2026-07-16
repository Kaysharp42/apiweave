export type ConflictWinner = "local" | "cloud";

export type ConflictKind =
  | "workspace"
  | "project"
  | "collection"
  | "workflow"
  | "environment";

export type ConflictPayload = Record<string, unknown>;

export interface ConflictListItem {
  readonly id: string;
  readonly workspace_id: string;
  readonly kind: ConflictKind;
  readonly record_id: string;
  readonly local_rev: number;
  readonly cloud_rev: number;
  readonly winner: ConflictWinner | null;
  readonly created_at: string;
  readonly resolved_at?: string | null;
}

export interface Conflict extends ConflictListItem {
  readonly local_payload: ConflictPayload;
  readonly cloud_payload: ConflictPayload;
}

export interface ResolveConflictRequest {
  readonly conflict_id: string;
  readonly winner: ConflictWinner;
  readonly device_id: string;
}

// --- Cloud sync status contract (mirrors desktop CloudSyncStatus) ---

export type CloudLinkState =
  | "unlinked"
  | "linking"
  | "linked"
  | "authenticationRequired";

export type CloudSyncState =
  | "idle"
  | "initializing"
  | "syncing"
  | "conflict"
  | "error"
  | "offline";

export interface CloudAccountIdentity {
  readonly accountId: string;
  readonly email?: string;
  readonly displayName?: string;
}

export interface CloudDeviceStatus {
  readonly deviceId: string;
  readonly label: string;
  readonly clientVersion: string;
  readonly createdAt: string;
}

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

export interface CloudSyncStatus {
  readonly linked: boolean;
  readonly active: boolean;
  readonly linkState: CloudLinkState;
  readonly syncState: CloudSyncState;
  readonly state: CloudSyncState;
  readonly pendingCount: number;
  readonly deadLetterCount: number;
  readonly conflictCount: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  readonly deviceId?: string;
  readonly device?: CloudDeviceStatus;
  readonly account?: CloudAccountIdentity;
  readonly workspaceIds: readonly string[];
  readonly bindings: readonly CloudWorkspaceBinding[];
  readonly workspaceCatalog: readonly CloudWorkspaceCatalogEntry[];
}

export interface CloudBindWorkspaceInput {
  readonly workspaceId: string;
  readonly cloudWorkspaceId: string;
  readonly teamId?: string | null;
  readonly syncMode?: "push" | "bi-directional";
}
