export type CloudSyncState = "idle" | "syncing" | "conflict" | "error"

export interface CloudLinkInput {
  readonly zitadelIssuer?: string
  readonly desktopClientId?: string
  readonly apiBaseUrl?: string
  readonly deviceLabel?: string
  readonly workspaceIds?: readonly string[]
}

export interface CloudBindWorkspaceInput {
  readonly workspaceId: string
  readonly cloudWorkspaceId?: string
  readonly teamId?: string | null
  readonly syncMode?: string
}

export interface CloudSyncStatus {
  readonly linked: boolean
  readonly active: boolean
  readonly state: CloudSyncState
  readonly deadLetterCount: number
  readonly deviceId?: string
  readonly workspaceIds: readonly string[]
}

export interface CloudSyncControl {
  readonly status: () => CloudSyncStatus
  readonly link: (input: CloudLinkInput) => Promise<CloudSyncStatus>
  readonly cancelLink: () => CloudSyncStatus
  readonly unlink: () => CloudSyncStatus
  readonly bindWorkspace: (input: CloudBindWorkspaceInput) => CloudSyncStatus
  readonly pull: () => Promise<CloudSyncStatus>
  readonly push: () => Promise<CloudSyncStatus>
}
