import type { SyncWorkspaceRole } from "@apiweave/proto/apiweave/v1/device_pb"

export type CloudLinkState = "unlinked" | "linking" | "linked" | "authenticationRequired"
export type CloudSyncState = "idle" | "initializing" | "syncing" | "conflict" | "error" | "offline"

export interface CloudLinkInput {
  readonly deviceLabel?: string
}

export interface CloudBindWorkspaceInput {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly teamId?: string | null
  readonly syncMode?: "push" | "bi-directional"
}

export interface CloudUnlinkInput {
  readonly localOnly?: boolean
}

export interface CloudUnbindWorkspaceInput {
  readonly workspaceId: string
}

export interface CloudInitializeWorkspaceInput {
  readonly workspaceId: string
}

export interface CloudDeadLetterInput {
  readonly workspaceId: string
}

export class CloudUnlinkRequiresConfirmationError extends Error {
  public constructor() {
    super(
      "Device revocation could not be confirmed. Retry while online or confirm a local-only disconnect; cloud access may remain until revoked from another session.",
    )
    this.name = "CloudUnlinkRequiresConfirmationError"
  }
}

export class CloudAccountMismatchError extends Error {
  public constructor() {
    super("This desktop is linked to a different cloud account. Disconnect it before linking another account.")
    this.name = "CloudAccountMismatchError"
  }
}

export class CloudAccountIdentityRequiredError extends Error {
  public constructor() {
    super("The existing cloud account cannot be verified safely. Disconnect it before linking again.")
    this.name = "CloudAccountIdentityRequiredError"
  }
}

export interface CloudAccountIdentity {
  readonly accountId: string
  readonly email?: string
  readonly displayName?: string
}

export interface CloudDeviceStatus {
  readonly deviceId: string
  readonly label: string
  readonly clientVersion: string
  readonly createdAt: string
}

export interface CloudWorkspaceBindingStatus {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly syncMode: string
  readonly initializationState: "pulling" | "pushing" | "initialized"
  readonly pendingCount: number
  readonly deadLetterCount: number
  readonly conflictCount: number
  readonly boundAt: string
  readonly lastSyncedAt?: string
  readonly initializedAt?: string
  readonly lastError?: string
}

export interface CloudWorkspaceCatalogEntry {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly isPersonal: boolean
  readonly effectiveRole: SyncWorkspaceRole
  readonly canPull: boolean
  readonly canPush: boolean
  readonly canResolveConflicts: boolean
}

export interface CloudSyncStatus {
  readonly linked: boolean
  readonly active: boolean
  readonly linkState: CloudLinkState
  readonly syncState: CloudSyncState
  readonly state: CloudSyncState
  readonly pendingCount: number
  readonly deadLetterCount: number
  readonly conflictCount: number
  readonly lastSyncedAt?: string
  readonly lastError?: string
  readonly deviceId?: string
  readonly device?: CloudDeviceStatus
  readonly account?: CloudAccountIdentity
  readonly workspaceIds: readonly string[]
  readonly bindings: readonly CloudWorkspaceBindingStatus[]
  readonly workspaceCatalog: readonly CloudWorkspaceCatalogEntry[]
}

export interface CloudSyncControl {
  readonly status: () => CloudSyncStatus
  readonly link: (input: CloudLinkInput) => Promise<CloudSyncStatus>
  readonly cancelLink: () => CloudSyncStatus
  readonly unlink: (input: CloudUnlinkInput) => Promise<CloudSyncStatus>
  readonly bindWorkspace: (input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>
  readonly initializeWorkspace: (input: CloudInitializeWorkspaceInput) => Promise<CloudSyncStatus>
  readonly unbindWorkspace: (input: CloudUnbindWorkspaceInput) => CloudSyncStatus
  readonly refreshWorkspaceCatalog: () => Promise<CloudSyncStatus>
  readonly retryDeadLetters: (input: CloudDeadLetterInput) => Promise<CloudSyncStatus>
  readonly discardDeadLetters: (input: CloudDeadLetterInput) => CloudSyncStatus
  readonly pull: () => Promise<CloudSyncStatus>
  readonly push: () => Promise<CloudSyncStatus>
}
