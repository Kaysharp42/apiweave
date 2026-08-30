// fallow-ignore-file code-duplication -- pure domain types for cloud sync: the
// one-error-per-case classes repeat by construction (see the inline markers
// below), and the workspace/team/device DTOs intentionally mirror each
// other's shared vocabulary (workspaceId, teamId, ...), same reasoning as
// CloudSyncRepository.ts's row models; fallow 2.104 has no range form, so
// file-level is the narrowest marker that still covers the groups
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

/**
 * A workspace's server-side encryption mode.
 *
 * `unspecified` is NOT `none`: it means the server did not say. The server
 * enforces `encryption_mode` write-once, so a workspace we cannot classify is
 * treated as locked and never pushed — pushing it as plaintext would commit it
 * to plaintext forever.
 */
export type WorkspaceEncryptionMode = "unspecified" | "none" | "e2ee"

/** What the UI renders for one bound workspace. */
export type CloudWorkspaceEncryptionState =
  /** Not end-to-end encrypted; syncs in the clear as it always has. */
  | "plaintext"
  /** End-to-end encrypted and its key is held: syncs normally. */
  | "unlocked"
  /** End-to-end encrypted and locked: needs `unlockWorkspace`. Sync is halted. */
  | "locked"
  /** Mode not known yet (no server answer). Treated as locked; a catalog refresh resolves it. */
  | "unknown"

export interface CloudWorkspaceRefInput {
  readonly workspaceId: string
}

export interface CloudWorkspacePassphraseInput {
  readonly workspaceId: string
  readonly passphrase: string
}

/**
 * A local workspace that cannot be provisioned to the cloud until someone
 * decides whether it should be end-to-end encrypted. See
 * {@link CloudSyncControl.setWorkspaceEncryption} and
 * {@link CloudSyncControl.declineWorkspaceEncryption}.
 */
export interface CloudPendingEncryptionDecision {
  readonly workspaceId: string
  readonly workspaceName: string
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

/**
 * The passphrase did not unlock the workspace. Deliberately one error for both
 * "the wrapped key failed to authenticate" and "it unwrapped to a key the
 * server does not name": the user-visible fact is identical and the split leaks
 * which half failed.
 */
// fallow-ignore-next-line code-duplication
export class CloudWorkspacePassphraseIncorrectError extends Error {
  public constructor() {
    super("That passphrase does not unlock this workspace.")
    this.name = "CloudWorkspacePassphraseIncorrectError"
  }
}

/**
 * The workspace's key is not held on this device, so there is nothing to
 * re-wrap. Unlocking first is strictly better than minting a new key, which
 * would strand every record already sealed under the old one.
 */
// fallow-ignore-next-line code-duplication
export class CloudWorkspaceLockedError extends Error {
  public constructor() {
    super("This workspace is locked. Unlock it with its current passphrase before changing it.")
    this.name = "CloudWorkspaceLockedError"
  }
}

/** Changing a workspace passphrase is admin-only, and the server is the judge. */
// fallow-ignore-next-line code-duplication
export class CloudWorkspacePassphraseAdminOnlyError extends Error {
  public constructor() {
    super("Only a workspace admin can change this workspace's passphrase.")
    this.name = "CloudWorkspacePassphraseAdminOnlyError"
  }
}

/** The workspace's stored encryption settings are unusable — refuse rather than guess. */
export class CloudWorkspaceEncryptionInvalidError extends Error {
  public constructor(reason: string) {
    super(`The workspace's stored encryption settings are unusable (${reason}).`)
    this.name = "CloudWorkspaceEncryptionInvalidError"
  }
}

/**
 * The workspace's encryption mode is already committed. The server enforces it
 * write-once: a workspace provisioned in the clear can never become encrypted,
 * and an encrypted one can never be downgraded.
 */
// fallow-ignore-next-line code-duplication
export class CloudWorkspaceEncryptionSettledError extends Error {
  public constructor() {
    super("This workspace's encryption setting was fixed when it was created and cannot be changed.")
    this.name = "CloudWorkspaceEncryptionSettledError"
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
  readonly encryption: CloudWorkspaceEncryptionState
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
  /** Absent on catalogs persisted before E2EE existed; absent reads as `unspecified`. */
  readonly encryptionMode?: WorkspaceEncryptionMode
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
  /**
   * End-to-end encrypt the new workspace under this passphrase. Omitted means
   * "no encryption" — an explicit choice, because this call always creates the
   * cloud row and the caller is the one deciding. Unlike reconciler
   * provisioning there is nobody else to ask, so there is no pending state.
   */
  readonly passphrase?: string
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
  /** Local workspaces held back from the cloud until an encryption choice is made. */
  readonly encryptionDecisionPending: readonly CloudPendingEncryptionDecision[]
}

export interface CloudSyncControl {
  readonly status: () => CloudSyncStatus
  readonly link: (input: CloudLinkInput) => Promise<CloudSyncStatus>
  readonly cancelLink: () => CloudSyncStatus
  readonly unlink: (input: CloudUnlinkInput) => Promise<CloudSyncStatus>
  readonly bindWorkspace: (input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>
  readonly createTeamWorkspace: (input: CloudCreateTeamWorkspaceInput) => Promise<Workspace>
  /**
   * Choose end-to-end encryption for a workspace. Before it is provisioned this
   * mints the workspace key and releases it from the pending gate; afterwards,
   * on an already-encrypted workspace whose key is unlocked, it re-wraps that
   * same key under the new passphrase (a passphrase change, admin only).
   */
  readonly setWorkspaceEncryption: (input: CloudWorkspacePassphraseInput) => Promise<CloudSyncStatus>
  /** Choose NO encryption, releasing the workspace from the pending gate. Irreversible once provisioned. */
  readonly declineWorkspaceEncryption: (input: CloudWorkspaceRefInput) => Promise<CloudSyncStatus>
  /** Unlock an encrypted workspace with its passphrase, so sync can resume. */
  readonly unlockWorkspace: (input: CloudWorkspacePassphraseInput) => Promise<CloudSyncStatus>
  /** Forget an unlocked key, here and in the OS keychain. Sync halts until unlocked again. */
  readonly lockWorkspace: (input: CloudWorkspaceRefInput) => CloudSyncStatus
  readonly initializeWorkspace: (input: CloudInitializeWorkspaceInput) => Promise<CloudSyncStatus>
  readonly unbindWorkspace: (input: CloudUnbindWorkspaceInput) => CloudSyncStatus
  readonly refreshWorkspaceCatalog: () => Promise<CloudSyncStatus>
  readonly retryDeadLetters: (input: CloudDeadLetterInput) => Promise<CloudSyncStatus>
  readonly discardDeadLetters: (input: CloudDeadLetterInput) => CloudSyncStatus
  readonly listFailedRecords: (input: CloudDeadLetterInput) => readonly CloudFailedRecord[]
  readonly pull: () => Promise<CloudSyncStatus>
  readonly push: () => Promise<CloudSyncStatus>
}
