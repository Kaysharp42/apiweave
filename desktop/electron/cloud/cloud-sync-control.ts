import { createHash, generateKeyPairSync } from "node:crypto"
import { hostname } from "node:os"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository } from "../../core/repositories"
import type { SyncProvider } from "../../core/sync"
import type {
  CloudBindWorkspaceInput,
  CloudLinkInput,
  CloudSyncControl,
  CloudSyncStatus,
  CloudWorkspaceCatalogEntry,
} from "../../core/services/cloud_sync_control"
import { LocalOnlySyncProvider } from "../../core/sync"
import { cancelDeviceLink, ErrLinkBusy, ErrLinkCancelled, startDeviceLink } from "./cloud-link"
import { CloudClient, DeviceTokenStore } from "./cloud-client"
import {
  CANONICAL_CLOUD_ENTRY_URL,
  fetchDesktopCloudConfig,
  normalizePublicBaseUrl,
  parseDesktopCloudConfig,
  type DesktopCloudConfig,
  type DesktopCloudConfigClient,
} from "./cloud-config"
import { CloudSyncProvider } from "./cloud-transport"
import { getState, setState } from "./cloud-state"

interface DesktopCloudSyncDefaults {
  readonly cloudEntryUrl: string
  readonly clientVersion: string
  readonly deviceLabel: string
}

export interface DesktopCloudSyncControlOptions {
  readonly store: KVStore
  readonly keyfilePath: string
  readonly defaults: DesktopCloudSyncDefaults
  readonly configClient?: DesktopCloudConfigClient
  readonly setSyncProviderTarget: (provider: SyncProvider) => void
}

const KEY_PUBLIC_CONFIG = "cloud.public_config"
const KEY_WORKSPACE_CATALOG = "cloud.workspace_catalog"

export class DesktopCloudSyncControl implements CloudSyncControl {
  private readonly repository: CloudSyncRepository
  private readonly tokenStore: DeviceTokenStore
  private activeProvider: CloudSyncProvider | null = null
  private activeConfig: DesktopCloudConfig | null
  private workspaceCatalog: readonly CloudWorkspaceCatalogEntry[]
  private linkController: AbortController | null = null

  public constructor(private readonly options: DesktopCloudSyncControlOptions) {
    this.repository = new CloudSyncRepository(options.store)
    this.tokenStore = new DeviceTokenStore(this.repository, options.keyfilePath)
    this.activeConfig = this.loadPersistedConfig()
    this.workspaceCatalog = this.loadWorkspaceCatalog()
    this.activateIfReady()
  }

  public status(): CloudSyncStatus {
    const deviceId = this.tokenStore.getDeviceId()
    const deadLetterCount = this.repository.countDeadLetterOutbox()
    return {
      linked: this.tokenStore.hasTokens(),
      active: this.activeProvider !== null,
      state: deadLetterCount > 0 ? "error" : getState(),
      deadLetterCount,
      ...(deviceId !== undefined ? { deviceId } : {}),
      workspaceIds: this.repository.listBoundCloudWorkspaceIds(),
      workspaceCatalog: this.workspaceCatalog,
    }
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    if (this.linkController !== null) {
      throw new ErrLinkBusy()
    }
    const controller = new AbortController()
    this.linkController = controller
    try {
      const configClient = this.options.configClient ?? fetchDesktopCloudConfig
      const config = await configClient(this.options.defaults.cloudEntryUrl, controller.signal)
      const result = await startDeviceLink({
        zitadelIssuer: config.oidcIssuer,
        desktopClientId: config.desktopClientId,
        apiBaseUrl: config.apiBaseUrl,
        keyfilePath: this.options.keyfilePath,
        deviceLabel: input.deviceLabel ?? this.options.defaults.deviceLabel,
        devicePublicKey: makeDevicePublicKey(),
        clientVersion: this.options.defaults.clientVersion,
        signal: controller.signal,
      })

      const catalog = result.workspaces.map(toCatalogEntry)
      this.repository.transaction((repository) => {
        const tokenStore = new DeviceTokenStore(repository, this.options.keyfilePath)
        tokenStore.setEncryptedTokens(
          result.device.deviceId,
          result.accessToken,
          result.encryptedRefreshToken,
          result.wrappedDek,
        )
        repository.upsertDevice({
          deviceId: result.device.deviceId,
          label: result.device.label,
          clientVersion: result.device.clientVersion,
          publicKey: result.device.publicKey,
          createdAt: result.device.createdAt,
        })
        repository.setSetting(KEY_PUBLIC_CONFIG, JSON.stringify(config))
        repository.setSetting(KEY_WORKSPACE_CATALOG, JSON.stringify(catalog))
      })

      this.activeConfig = config
      this.workspaceCatalog = catalog
      this.activateIfReady()
      return this.status()
    } finally {
      if (this.linkController === controller) {
        this.linkController = null
      }
    }
  }

  public cancelLink(): CloudSyncStatus {
    this.linkController?.abort(new ErrLinkCancelled())
    cancelDeviceLink()
    return this.status()
  }

  public unlink(): CloudSyncStatus {
    cancelDeviceLink()
    this.tokenStore.clearTokens()
    this.repository.clearCloudDeviceState()
    this.repository.deleteSetting(KEY_WORKSPACE_CATALOG)
    this.repository.deleteSetting(KEY_PUBLIC_CONFIG)
    this.activeProvider = null
    this.activeConfig = null
    this.workspaceCatalog = []
    this.options.setSyncProviderTarget(new LocalOnlySyncProvider())
    setState("idle")
    return this.status()
  }

  public bindWorkspace(input: CloudBindWorkspaceInput): CloudSyncStatus {
    const deviceId = this.tokenStore.getDeviceId()
    const target = this.workspaceCatalog.find((workspace) => workspace.workspaceId === input.cloudWorkspaceId)
    if (target === undefined) {
      throw new Error("Cloud workspace is not authorized for this account")
    }
    this.repository.upsertWorkspaceBinding({
      workspaceId: input.workspaceId,
      cloudWorkspaceId: input.cloudWorkspaceId,
      teamId: input.teamId ?? null,
      syncMode: input.syncMode ?? "bi-directional",
      ...(deviceId !== undefined ? { deviceId } : {}),
    })
    this.activateIfReady()
    return this.status()
  }

  public async pull(): Promise<CloudSyncStatus> {
    const provider = this.requireActiveProvider()
    await provider.pull()
    return this.status()
  }

  public async push(): Promise<CloudSyncStatus> {
    const provider = this.requireActiveProvider()
    await provider.push()
    return this.status()
  }

  private activateIfReady(): void {
    const workspaceBindings = this.repository.listWorkspaceBindings()
    if (!this.tokenStore.hasTokens() || workspaceBindings.length === 0 || this.activeConfig === null) {
      return
    }

    const client = new CloudClient(
      { baseUrl: this.activeConfig.apiBaseUrl, clientVersion: this.options.defaults.clientVersion },
      this.tokenStore,
    )
    const provider = new CloudSyncProvider(client, this.tokenStore, this.options.store, {
      workspaceBindings,
      zitadelIssuer: this.activeConfig.oidcIssuer,
      clientId: this.activeConfig.desktopClientId,
    }, (state) => setState(state))
    this.activeProvider = provider
    this.options.setSyncProviderTarget(provider)
    setState(this.repository.countDeadLetterOutbox() > 0 ? "error" : "idle")
  }

  private requireActiveProvider(): CloudSyncProvider {
    this.activateIfReady()
    if (this.activeProvider === null) {
      throw new Error("Cloud sync is not linked to any workspace")
    }
    return this.activeProvider
  }

  private loadPersistedConfig(): DesktopCloudConfig | null {
    const value = this.repository.getSetting(KEY_PUBLIC_CONFIG)
    if (value === undefined) {
      return null
    }
    try {
      return parseDesktopCloudConfig(JSON.parse(value), normalizePublicBaseUrl(this.options.defaults.cloudEntryUrl))
    } catch {
      this.repository.deleteSetting(KEY_PUBLIC_CONFIG)
      return null
    }
  }

  private loadWorkspaceCatalog(): readonly CloudWorkspaceCatalogEntry[] {
    const value = this.repository.getSetting(KEY_WORKSPACE_CATALOG)
    if (value === undefined) {
      return []
    }
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter(isCatalogEntry) : []
    } catch {
      return []
    }
  }
}

export function cloudDefaults(version: string): DesktopCloudSyncDefaults {
  return {
    cloudEntryUrl: process.env["APIWEAVE_CLOUD_ENTRY_URL"] ?? CANONICAL_CLOUD_ENTRY_URL,
    clientVersion: version,
    deviceLabel: `${hostname() || "APIWeave Desktop"}`,
  }
}

function toCatalogEntry(workspace: import("@apiweave/proto/apiweave/v1/device_pb").SyncWorkspace): CloudWorkspaceCatalogEntry {
  return {
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    ...(workspace.teamId !== "" ? { teamId: workspace.teamId } : {}),
    ...(workspace.teamName !== "" ? { teamName: workspace.teamName } : {}),
    isPersonal: workspace.isPersonal,
    effectiveRole: workspace.effectiveRole,
    canPull: workspace.capabilities?.canPull ?? false,
    canPush: workspace.capabilities?.canPush ?? false,
    canResolveConflicts: workspace.capabilities?.canResolveConflicts ?? false,
  }
}

function isCatalogEntry(value: unknown): value is CloudWorkspaceCatalogEntry {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  return typeof entry["workspaceId"] === "string"
    && typeof entry["workspaceName"] === "string"
    && (entry["teamId"] === undefined || typeof entry["teamId"] === "string")
    && (entry["teamName"] === undefined || typeof entry["teamName"] === "string")
    && typeof entry["isPersonal"] === "boolean"
    && typeof entry["effectiveRole"] === "number"
    && typeof entry["canPull"] === "boolean"
    && typeof entry["canPush"] === "boolean"
    && typeof entry["canResolveConflicts"] === "boolean"
}

function makeDevicePublicKey(): Uint8Array {
  const publicKeyDer = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" })
  if (publicKeyDer.length >= 32) {
    return new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32))
  }
  return createHash("sha256").update(publicKeyDer).digest()
}
