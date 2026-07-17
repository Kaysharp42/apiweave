import { createHash, generateKeyPairSync } from "node:crypto"
import { hostname } from "node:os"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository } from "../../core/repositories"
import { CloudFirstSyncService } from "../../core/services/cloud_first_sync_service"
import type { SyncProvider } from "../../core/sync"
import {
  CloudUnlinkRequiresConfirmationError,
  CloudAccountIdentityRequiredError,
  CloudAccountMismatchError,
  type CloudAccountIdentity,
  type CloudBindWorkspaceInput,
  type CloudDeadLetterInput,
  type CloudInitializeWorkspaceInput,
  type CloudLinkInput,
  type CloudSyncControl,
  type CloudSyncStatus,
  type CloudSyncState,
  type CloudUnbindWorkspaceInput,
  type CloudUnlinkInput,
  type CloudWorkspaceBindingStatus,
  type CloudWorkspaceCatalogEntry,
} from "../../core/services/cloud_sync_control"
import { LocalOnlySyncProvider } from "../../core/sync"
import {
  cancelDeviceLink,
  ErrLinkAccountMismatch,
  ErrLinkBusy,
  ErrLinkCancelled,
  startDeviceLink,
} from "./cloud-link"
import { CloudClient, DeviceTokenStore, ErrCloudOffline } from "./cloud-client"
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
import type { SyncConflictResolver } from "./conflict-ui-bridge"

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
  readonly linkClient?: typeof startDeviceLink
  readonly setSyncProviderTarget: (provider: SyncProvider) => void
  readonly onStatusChanged?: () => void
}

const KEY_PUBLIC_CONFIG = "cloud.public_config"
const KEY_WORKSPACE_CATALOG = "cloud.workspace_catalog"
const KEY_ACCOUNT_IDENTITY = "cloud.account_identity"
const KEY_AUTHENTICATION_REQUIRED = "cloud.authentication_required"

export class DesktopCloudSyncControl implements CloudSyncControl {
  private readonly repository: CloudSyncRepository
  private readonly tokenStore: DeviceTokenStore
  private readonly firstSyncService: CloudFirstSyncService
  private activeProvider: CloudSyncProvider | null = null
  private activeConfig: DesktopCloudConfig | null
  private workspaceCatalog: readonly CloudWorkspaceCatalogEntry[]
  private linkController: AbortController | null = null

  public constructor(private readonly options: DesktopCloudSyncControlOptions) {
    this.repository = new CloudSyncRepository(options.store)
    this.tokenStore = new DeviceTokenStore(this.repository, options.keyfilePath)
    this.firstSyncService = new CloudFirstSyncService(options.store)
    this.activeConfig = this.loadPersistedConfig()
    this.workspaceCatalog = this.loadWorkspaceCatalog()
    this.activateIfReady(true)
  }

  public status(): CloudSyncStatus {
    const deviceId = this.tokenStore.getDeviceId()
    const linked = this.tokenStore.hasTokens()
    const bindings = this.repository.listWorkspaceBindings().map((binding): CloudWorkspaceBindingStatus => ({
      workspaceId: binding.workspaceId,
      workspaceName: this.repository.getWorkspaceName(binding.workspaceId) ?? "Unknown workspace",
      cloudWorkspaceId: binding.cloudWorkspaceId,
      cloudWorkspaceName: binding.cloudWorkspaceName,
      ...(binding.teamId !== null ? { teamId: binding.teamId } : {}),
      ...(binding.teamName !== null ? { teamName: binding.teamName } : {}),
      syncMode: binding.syncMode,
      initializationState: binding.initializationState,
      pendingCount: this.repository.countPendingOutbox(binding.workspaceId),
      deadLetterCount: this.repository.countDeadLetterOutbox(binding.workspaceId),
      conflictCount: this.repository.countPendingConflicts(binding.workspaceId),
      boundAt: binding.boundAt,
      ...(binding.lastSyncedAt !== null ? { lastSyncedAt: binding.lastSyncedAt } : {}),
      ...(binding.initializedAt !== null ? { initializedAt: binding.initializedAt } : {}),
      ...(binding.lastError !== null ? { lastError: binding.lastError } : {}),
    }))
    const pendingCount = this.repository.countPendingOutbox()
    const deadLetterCount = this.repository.countDeadLetterOutbox()
    const conflictCount = this.repository.countPendingConflicts()
    const syncState = this.resolveSyncState(bindings, deadLetterCount, conflictCount)
    const device = deviceId === undefined ? undefined : this.repository.getDevice(deviceId)
    const account = this.loadAccountIdentity()
    const lastSyncedAt = bindings
      .flatMap((binding) => binding.lastSyncedAt === undefined ? [] : [binding.lastSyncedAt])
      .sort()
      .at(-1)
    const lastError = bindings.find((binding) => binding.lastError !== undefined)?.lastError
    return {
      linked,
      active: this.activeProvider !== null,
      linkState: this.linkController !== null
        ? "linking"
        : linked && this.authenticationRequired()
          ? "authenticationRequired"
          : linked ? "linked" : "unlinked",
      syncState,
      state: syncState,
      pendingCount,
      deadLetterCount,
      conflictCount,
      ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(device !== undefined ? { device } : {}),
      ...(account !== undefined ? { account } : {}),
      workspaceIds: bindings.map((binding) => binding.cloudWorkspaceId),
      bindings,
      workspaceCatalog: this.workspaceCatalog,
    }
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    if (this.linkController !== null) {
      throw new ErrLinkBusy()
    }
    const controller = new AbortController()
    this.linkController = controller
    this.notifyStatusChanged()
    try {
      const existingAccount = this.loadAccountIdentity()
      if (existingAccount === undefined && this.repository.listWorkspaceBindings().length > 0) {
        throw new CloudAccountIdentityRequiredError()
      }
      const configClient = this.options.configClient ?? fetchDesktopCloudConfig
      const config = await configClient(this.options.defaults.cloudEntryUrl, controller.signal)
      const linkClient = this.options.linkClient ?? startDeviceLink
      const result = await linkClient({
        zitadelIssuer: config.oidcIssuer,
        desktopClientId: config.desktopClientId,
        apiBaseUrl: config.apiBaseUrl,
        keyfilePath: this.options.keyfilePath,
        deviceLabel: input.deviceLabel ?? this.options.defaults.deviceLabel,
        devicePublicKey: makeDevicePublicKey(),
        clientVersion: this.options.defaults.clientVersion,
        signal: controller.signal,
        ...(existingAccount !== undefined ? { expectedAccountId: existingAccount.accountId } : {}),
      })
      if (existingAccount !== undefined && result.account.accountId !== existingAccount.accountId) {
        throw new CloudAccountMismatchError()
      }

      const catalog = result.workspaces.map(toCatalogEntry)
      this.repository.transaction((repository) => {
        const tokenStore = new DeviceTokenStore(repository, this.options.keyfilePath)
        tokenStore.setEncryptedTokens(
          result.device.deviceId,
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
        repository.setSetting(KEY_ACCOUNT_IDENTITY, JSON.stringify(result.account))
        repository.deleteSetting(KEY_AUTHENTICATION_REQUIRED)
      })

      this.tokenStore.setAccessToken(result.accessToken)
      this.activeConfig = config
      this.workspaceCatalog = catalog
      this.activateIfReady(false, true)
      if (this.linkController === controller) {
        this.linkController = null
      }
      this.notifyStatusChanged()
      return this.status()
    } catch (error) {
      if (error instanceof ErrLinkAccountMismatch) {
        throw new CloudAccountMismatchError()
      }
      throw error
    } finally {
      if (this.linkController === controller) {
        this.linkController = null
      }
      this.notifyStatusChanged()
    }
  }

  public cancelLink(): CloudSyncStatus {
    this.linkController?.abort(new ErrLinkCancelled())
    cancelDeviceLink()
    this.notifyStatusChanged()
    return this.status()
  }

  public async unlink(input: CloudUnlinkInput): Promise<CloudSyncStatus> {
    this.linkController?.abort(new ErrLinkCancelled())
    cancelDeviceLink()
    this.activeProvider?.deactivate()
    this.activeProvider = null
    this.options.setSyncProviderTarget(new LocalOnlySyncProvider())

    const deviceId = this.tokenStore.getDeviceId()
    if (deviceId !== undefined && this.tokenStore.hasTokens()) {
      try {
        if (this.activeConfig === null) {
          throw new Error("Cloud configuration is unavailable")
        }
        await this.createClient(this.activeConfig).revokeDevice(deviceId)
      } catch {
        if (input.localOnly !== true) {
          this.activateIfReady()
          this.notifyStatusChanged()
          throw new CloudUnlinkRequiresConfirmationError()
        }
      }
    }

    this.repository.transaction((repository) => {
      this.tokenStore.clearTokens()
      repository.clearCloudDeviceState()
      repository.deleteSetting(KEY_WORKSPACE_CATALOG)
      repository.deleteSetting(KEY_PUBLIC_CONFIG)
      repository.deleteSetting(KEY_ACCOUNT_IDENTITY)
      repository.deleteSetting(KEY_AUTHENTICATION_REQUIRED)
    })
    this.activeConfig = null
    this.workspaceCatalog = []
    setState("idle")
    this.notifyStatusChanged()
    return this.status()
  }

  public async bindWorkspace(input: CloudBindWorkspaceInput): Promise<CloudSyncStatus> {
    const deviceId = this.tokenStore.getDeviceId()
    if (deviceId === undefined || !this.tokenStore.hasTokens()) {
      throw new Error("Cloud account must be linked before binding a workspace")
    }
    const target = this.workspaceCatalog.find((workspace) => workspace.workspaceId === input.cloudWorkspaceId)
    if (target === undefined) {
      throw new Error("Cloud workspace is not authorized for this account")
    }
    if (!target.canPull || !target.canPush) {
      throw new Error("Cloud workspace does not allow the required sync capabilities")
    }
    if (input.teamId !== undefined && input.teamId !== null && input.teamId !== target.teamId) {
      throw new Error("Cloud workspace team metadata does not match the authorized catalog")
    }
    const binding = this.firstSyncService.bindAndSnapshot({
      workspaceId: input.workspaceId,
      cloudWorkspaceId: input.cloudWorkspaceId,
      cloudWorkspaceName: target.workspaceName,
      ...(target.teamId !== undefined ? { teamId: target.teamId } : {}),
      ...(target.teamName !== undefined ? { teamName: target.teamName } : {}),
      syncMode: input.syncMode ?? "bi-directional",
      deviceId,
    })
    this.activateIfReady(false, true)
    const provider = this.requireActiveProvider()
    void provider.initializeWorkspace(binding.workspaceId)
      .catch(() => undefined)
      .finally(() => this.notifyStatusChanged())
    this.notifyStatusChanged()
    return this.status()
  }

  public unbindWorkspace(input: CloudUnbindWorkspaceInput): CloudSyncStatus {
    this.repository.removeWorkspaceBinding(input.workspaceId)
    this.activateIfReady(false, true)
    this.notifyStatusChanged()
    return this.status()
  }

  public async initializeWorkspace(input: CloudInitializeWorkspaceInput): Promise<CloudSyncStatus> {
    if (this.repository.getWorkspaceBinding(input.workspaceId) === undefined) {
      throw new Error("Cloud workspace binding is unavailable")
    }
    try {
      await this.requireActiveProvider().initializeWorkspace(input.workspaceId)
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  public async refreshWorkspaceCatalog(): Promise<CloudSyncStatus> {
    if (!this.tokenStore.hasTokens() || this.activeConfig === null) {
      throw new Error("Cloud account must be linked before refreshing workspaces")
    }
    try {
      const response = await this.createClient(this.activeConfig).listSyncWorkspaces()
      const catalog = response.workspaces.map(toCatalogEntry)
      this.repository.setSetting(KEY_WORKSPACE_CATALOG, JSON.stringify(catalog))
      this.workspaceCatalog = catalog
      setState("idle")
      return this.status()
    } catch (error) {
      setState(error instanceof ErrCloudOffline ? "offline" : "error")
      throw error
    } finally {
      this.notifyStatusChanged()
    }
  }

  public async retryDeadLetters(input: CloudDeadLetterInput): Promise<CloudSyncStatus> {
    if (this.repository.getWorkspaceBinding(input.workspaceId) === undefined) {
      throw new Error("Cloud workspace binding is unavailable")
    }
    const requeued = this.repository.retryDeadLetterOutbox(input.workspaceId)
    if (requeued === 0) {
      this.notifyStatusChanged()
      return this.status()
    }
    // Rows are back in the pending queue; drive a push to re-send them. If we're
    // offline the rows stay safely queued and will drain on the next sync, so
    // report offline rather than surfacing a hard error for a successful requeue.
    try {
      await this.requireActiveProvider().push()
      return this.status()
    } catch (error) {
      if (!(error instanceof ErrCloudOffline)) {
        throw error
      }
      setState("offline")
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  public discardDeadLetters(input: CloudDeadLetterInput): CloudSyncStatus {
    if (this.repository.getWorkspaceBinding(input.workspaceId) === undefined) {
      throw new Error("Cloud workspace binding is unavailable")
    }
    this.repository.discardDeadLetterOutbox(input.workspaceId)
    // Clearing the last dead letter clears the durable error state (the active
    // provider stays put, so recompute it here rather than relying on a
    // re-activation).
    if (getState() === "error" && this.repository.countDeadLetterOutbox() === 0 && !this.authenticationRequired()) {
      setState("idle")
    }
    this.notifyStatusChanged()
    return this.status()
  }

  public async pull(): Promise<CloudSyncStatus> {
    const provider = this.requireActiveProvider()
    try {
      await provider.pull()
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  public async push(): Promise<CloudSyncStatus> {
    const provider = this.requireActiveProvider()
    try {
      await provider.push()
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  /**
   * Resolver the conflict-UI bridge calls when a conflict has a server-side ID.
   * Delegates to an authenticated {@link CloudClient} so it inherits the same
   * one-refresh/one-retry behaviour as every other RPC. The device ID is sourced
   * from the token store inside the client — the caller-supplied `device_id` is
   * ignored (the renderer must not authorize its own device).
   */
  public getConflictResolver(): SyncConflictResolver {
    return {
      resolveConflict: async ({ conflict_id, winner }) => {
        if (this.activeConfig === null) {
          throw new Error("Cloud configuration is unavailable")
        }
        await this.createClient(this.activeConfig).resolveConflict(conflict_id, winner)
      },
    }
  }

  private activateIfReady(resumePending = false, replace = false): void {
    if (this.activeProvider !== null && !replace) {
      return
    }
    if (replace && this.activeProvider !== null) {
      this.activeProvider.deactivate()
      this.activeProvider = null
    }
    const workspaceBindings = this.repository.listWorkspaceBindings()
    if (!this.tokenStore.hasTokens() || workspaceBindings.length === 0 || this.activeConfig === null) {
      if (replace) {
        this.options.setSyncProviderTarget(new LocalOnlySyncProvider())
        setState("idle")
      }
      return
    }

    const client = this.createClient(this.activeConfig)
    const provider = new CloudSyncProvider(client, this.tokenStore, this.options.store, {
      workspaceBindings,
    }, (state) => {
      setState(state)
      this.notifyStatusChanged()
    })
    this.activeProvider = provider
    this.options.setSyncProviderTarget(provider)
    setState(this.repository.countDeadLetterOutbox() > 0 ? "error" : "idle")
    if (resumePending && workspaceBindings.some((binding) => binding.initializationState !== "initialized")) {
      void provider.resumePendingInitializations().catch(() => undefined)
    }
  }

  private requireActiveProvider(): CloudSyncProvider {
    this.activateIfReady()
    if (this.activeProvider === null) {
      throw new Error("Cloud sync is not linked to any workspace")
    }
    return this.activeProvider
  }

  private createClient(config: DesktopCloudConfig): CloudClient {
    return new CloudClient(
      {
        baseUrl: config.apiBaseUrl,
        clientVersion: this.options.defaults.clientVersion,
        zitadelIssuer: config.oidcIssuer,
        clientId: config.desktopClientId,
      },
      this.tokenStore,
      {
        onAuthenticationRequired: () => this.markAuthenticationRequired(),
        onAuthenticated: () => this.markAuthenticated(),
      },
    )
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

  private loadAccountIdentity(): CloudAccountIdentity | undefined {
    const value = this.repository.getSetting(KEY_ACCOUNT_IDENTITY)
    if (value === undefined) {
      return undefined
    }
    try {
      const parsed = JSON.parse(value) as unknown
      return isAccountIdentity(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private authenticationRequired(): boolean {
    return this.repository.getSetting(KEY_AUTHENTICATION_REQUIRED) === "true"
  }

  private markAuthenticationRequired(): void {
    if (!this.tokenStore.hasTokens()) {
      return
    }
    this.repository.setSetting(KEY_AUTHENTICATION_REQUIRED, "true")
    setState("error")
    this.notifyStatusChanged()
  }

  private markAuthenticated(): void {
    if (!this.tokenStore.hasTokens()) {
      return
    }
    this.repository.deleteSetting(KEY_AUTHENTICATION_REQUIRED)
    this.notifyStatusChanged()
  }

  private resolveSyncState(
    bindings: readonly CloudWorkspaceBindingStatus[],
    deadLetterCount: number,
    conflictCount: number,
  ): CloudSyncState {
    const current = getState()
    if (this.authenticationRequired() || deadLetterCount > 0) {
      return "error"
    }
    if (conflictCount > 0) {
      return "conflict"
    }
    if (bindings.some((binding) => binding.lastError?.includes("ErrCloudOffline") === true)) {
      return "offline"
    }
    if (bindings.some((binding) => binding.lastError !== undefined)) {
      return "error"
    }
    if (current === "offline" || current === "syncing" || current === "initializing") {
      return current
    }
    if (bindings.some((binding) => binding.initializationState !== "initialized")) {
      return "initializing"
    }
    return current
  }

  private notifyStatusChanged(): void {
    this.options.onStatusChanged?.()
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

function isAccountIdentity(value: unknown): value is CloudAccountIdentity {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const account = value as Record<string, unknown>
  return typeof account["accountId"] === "string"
    && account["accountId"].length > 0
    && (account["email"] === undefined || typeof account["email"] === "string")
    && (account["displayName"] === undefined || typeof account["displayName"] === "string")
    && (account["avatarUrl"] === undefined || typeof account["avatarUrl"] === "string")
}

function makeDevicePublicKey(): Uint8Array {
  const publicKeyDer = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" })
  if (publicKeyDer.length >= 32) {
    return new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32))
  }
  return createHash("sha256").update(publicKeyDer).digest()
}
