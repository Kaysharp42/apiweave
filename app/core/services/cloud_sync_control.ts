import type { SyncWorkspaceRole } from "@apiweave/proto/apiweave/v1/device_pb"
import type { Workspace } from "@shared/types/Workspace"

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
  /**
   * Also delete every local workspace stamped with the account being
   * disconnected. Destructive and irreversible, so it is opt-in per
   * disconnect: omitted or false keeps locally-authored workspaces.
   */
  readonly purgeLocalData?: boolean
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

/** One dead-lettered change, named so the user can find the record it belongs to. */
export interface CloudFailedRecord {
  readonly outboxId: string
  readonly kind: string
  readonly recordId: string
  readonly recordName?: string
  readonly op: string
  readonly failureReason?: string
  readonly attempts: number
  readonly queuedAt: string
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

// This class necessarily repeats the one-error-per-case shape used by every
// sibling in this file and in cloud-link.ts's ErrLinkXxx family — that
// boilerplate is the established idiom here, not something to abstract away.
// fallow-ignore-next-line code-duplication
export class CloudWorkspaceOwnedByAnotherAccountError extends Error {
  public constructor() {
    super(
      "This workspace holds data from a different cloud account. Remove it from this device, or link the account that owns it.",
    )
    this.name = "CloudWorkspaceOwnedByAnotherAccountError"
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
  readonly avatarUrl?: string
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

export interface CloudTeamCatalogEntry {
  readonly teamId: string
  readonly teamName: string
  readonly isPersonal: boolean
  readonly canCreateWorkspaces: boolean
}

export interface CloudCreateTeamWorkspaceInput {
  readonly name: string
  readonly slug: string
  readonly description?: string | null
  readonly teamId?: string
  readonly newTeamName?: string
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
  readonly teamCatalog: readonly CloudTeamCatalogEntry[]
}

export interface CloudSyncControl {
  readonly status: () => CloudSyncStatus
  readonly link: (input: CloudLinkInput) => Promise<CloudSyncStatus>
  readonly cancelLink: () => CloudSyncStatus
  readonly unlink: (input: CloudUnlinkInput) => Promise<CloudSyncStatus>
  readonly bindWorkspace: (input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>
  readonly createTeamWorkspace: (input: CloudCreateTeamWorkspaceInput) => Promise<Workspace>
  readonly initializeWorkspace: (input: CloudInitializeWorkspaceInput) => Promise<CloudSyncStatus>
  readonly unbindWorkspace: (input: CloudUnbindWorkspaceInput) => CloudSyncStatus
  readonly refreshWorkspaceCatalog: () => Promise<CloudSyncStatus>
  readonly retryDeadLetters: (input: CloudDeadLetterInput) => Promise<CloudSyncStatus>
  readonly discardDeadLetters: (input: CloudDeadLetterInput) => CloudSyncStatus
  readonly listFailedRecords: (input: CloudDeadLetterInput) => readonly CloudFailedRecord[]
  readonly pull: () => Promise<CloudSyncStatus>
  readonly push: () => Promise<CloudSyncStatus>
}
