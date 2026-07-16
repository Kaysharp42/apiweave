import type { SyncWorkspaceRole } from "@apiweave/proto/apiweave/v1/device_pb"

export type CloudSyncState = "idle" | "syncing" | "conflict" | "error"

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

export class CloudUnlinkRequiresConfirmationError extends Error {
  public constructor() {
    super(
      "Device revocation could not be confirmed. Retry while online or confirm a local-only disconnect; cloud access may remain until revoked from another session.",
    )
    this.name = "CloudUnlinkRequiresConfirmationError"
  }
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
  readonly state: CloudSyncState
  readonly deadLetterCount: number
  readonly deviceId?: string
  readonly workspaceIds: readonly string[]
  readonly workspaceCatalog: readonly CloudWorkspaceCatalogEntry[]
}

export interface CloudSyncControl {
  readonly status: () => CloudSyncStatus
  readonly link: (input: CloudLinkInput) => Promise<CloudSyncStatus>
  readonly cancelLink: () => CloudSyncStatus
  readonly unlink: (input: CloudUnlinkInput) => Promise<CloudSyncStatus>
  readonly bindWorkspace: (input: CloudBindWorkspaceInput) => Promise<CloudSyncStatus>
  readonly pull: () => Promise<CloudSyncStatus>
  readonly push: () => Promise<CloudSyncStatus>
}
