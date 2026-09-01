import { createHash, generateKeyPairSync } from "node:crypto"
import { hostname } from "node:os"
import type { KVStore } from "../../core/db"
import { generateId } from "../../core/id"
import { getLogger } from "../../core/logging/logger"
import type { Workspace } from "@shared/types/Workspace"
import {
  AppSettingsRepository,
  CloudSyncRepository,
  WorkspaceRepository,
  type CloudWorkspaceBinding,
} from "../../core/repositories"
import { CloudFirstSyncService } from "../../core/services/cloud_first_sync_service"
import {
  isWorkspaceClaimable,
  reconcileWorkspaces,
  type ReconcilerBindInput,
  type ReconcilerCatalogEntry,
  type ReconcilerEncryptionPlan,
} from "./cloud-workspace-reconciler"
import type { SyncProvider } from "../../core/sync"
import {
  CloudUnlinkRequiresConfirmationError,
  CloudAccountIdentityRequiredError,
  CloudAccountMismatchError,
  CloudWorkspaceEncryptionInvalidError,
  CloudWorkspaceEncryptionSettledError,
  CloudWorkspaceLockedError,
  CloudWorkspaceOwnedByAnotherAccountError,
  CloudWorkspacePassphraseAdminOnlyError,
  type CloudAccountIdentity,
  type CloudBindWorkspaceInput,
  type CloudCreateTeamWorkspaceInput,
  type CloudDeadLetterInput,
  type CloudFailedRecord,
  type CloudInitializeWorkspaceInput,
  type CloudLinkInput,
  type CloudSyncControl,
  type CloudSyncStatus,
  type CloudSyncState,
  type CloudPendingEncryptionDecision,
  type CloudUnbindWorkspaceInput,
  type CloudUnlinkInput,
  type CloudWorkspaceEncryptionState,
  type CloudWorkspacePassphraseInput,
  type CloudWorkspaceRefInput,
  type WorkspaceEncryptionMode,
  type CloudWorkspaceBindingStatus,
  type CloudWorkspaceCatalogEntry,
  type CloudTeamCatalogEntry,
} from "../../core/services/cloud_sync_control"
import { LocalOnlySyncProvider } from "../../core/sync"
import {
  cancelDeviceLink,
  ErrLinkAccountMismatch,
  ErrLinkBusy,
  ErrLinkCancelled,
  startDeviceLink,
} from "./cloud-link"
import {
  CloudClient,
  DeviceTokenStore,
  ErrCloudOffline,
  ErrCloudRequestFailed,
} from "./cloud-client"
import {
  CANONICAL_CLOUD_ENTRY_URL,
  fetchDesktopCloudConfig,
  normalizePublicBaseUrl,
  parseDesktopCloudConfig,
  type DesktopCloudConfig,
  type DesktopCloudConfigClient,
} from "./cloud-config"
import { CloudSyncProvider } from "./cloud-transport"
import { cacheWdek, clearCachedWdek, readCachedWdek } from "./wdek-cache"
import {
  clearWorkspaceEncryption as unregisterWorkspaceKey,
  hasWorkspaceKey,
  setWorkspaceEncryption as registerWorkspaceKey,
  workspaceWdek,
} from "./workspace-keys"
import {
  createEncryptionBundle,
  encryptionModeOf,
  openEncryptionBundle,
  rewrapBundle,
  type WorkspaceEncryptionBundle,
} from "./workspace-encryption"
import { getState, setState } from "./cloud-state"
import type { SyncConflictResolver } from "./conflict-ui-bridge"

const cloudSyncControlLog = getLogger("cloud-sync")
const cloudReconcileLog = getLogger("cloud-reconcile")

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
  /**
   * Pulled workflow writes land in SQLite through this repository's raw SQL,
   * not through `WorkflowRepository`, so the open-canvas broadcast needs its
   * own hook here. `deleted` reports a pulled tombstone; for an upsert the
   * caller resolves the authoritative row itself.
   */
  readonly onWorkflowChanged?: (workspaceId: string, workflowId: string, deleted: boolean) => void
}

const KEY_PUBLIC_CONFIG = "cloud.public_config"
const KEY_WORKSPACE_CATALOG = "cloud.workspace_catalog"
const KEY_TEAM_CATALOG = "cloud.team_catalog"
const KEY_ACCOUNT_IDENTITY = "cloud.account_identity"
const KEY_AUTHENTICATION_REQUIRED = "cloud.authentication_required"
/**
 * Per-local-workspace encryption state, alongside `wdek-cache.ts`'s
 * `cloud.e2ee.wdek.<id>` in the same `app_settings` table.
 *
 * `mode` is both the user's DECISION (before provisioning) and the server's
 * ANSWER (after it, overwritten from every provisioning response and catalog
 * refresh). Absent means nobody has decided and the server has not said:
 * pending, which blocks provisioning and blocks sync. `pending` holds the
 * derived bundle between "the user chose a passphrase" and "the cloud row
 * exists", so a crash in between does not lose the decision — and so a retry
 * re-sends the byte-identical bundle the server's request-id rule demands.
 */
const KEY_ENCRYPTION_MODE_PREFIX = "cloud.e2ee.mode."
const KEY_ENCRYPTION_PENDING_PREFIX = "cloud.e2ee.pending."

export class DesktopCloudSyncControl implements CloudSyncControl {
  private readonly repository: CloudSyncRepository
  private readonly settings: AppSettingsRepository
  private readonly tokenStore: DeviceTokenStore
  private readonly firstSyncService: CloudFirstSyncService
  private activeProvider: CloudSyncProvider | null = null
  private activeConfig: DesktopCloudConfig | null
  private workspaceCatalog: readonly CloudWorkspaceCatalogEntry[]
  private teamCatalog: readonly CloudTeamCatalogEntry[]
  private linkController: AbortController | null = null
  private reconcileInFlight: Promise<void> | null = null

  public constructor(private readonly options: DesktopCloudSyncControlOptions) {
    this.repository = new CloudSyncRepository(options.store, options.onWorkflowChanged)
    this.settings = new AppSettingsRepository(options.store)
    this.tokenStore = new DeviceTokenStore(this.repository, options.keyfilePath)
    this.firstSyncService = new CloudFirstSyncService(options.store)
    this.activeConfig = this.loadPersistedConfig()
    this.workspaceCatalog = this.loadWorkspaceCatalog()
    this.teamCatalog = this.loadTeamCatalog()
    this.activateIfReady(true)
    this.backfillEncryptionModes()
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
      encryption: this.encryptionStateOf(binding.workspaceId),
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
      teamCatalog: this.teamCatalog,
      encryptionDecisionPending: linked ? this.pendingEncryptionDecisions(bindings) : [],
    }
  }

  /**
   * Choose end-to-end encryption for a workspace.
   *
   * Before provisioning this mints the workspace key, caches it, registers it
   * for the transport and records the decision — which is what releases the
   * workspace from the reconciler's pending gate — then reconciles so the
   * workspace is provisioned WITH its bundle. Afterwards, on an already-
   * encrypted workspace whose key is unlocked, it re-wraps that same key under
   * the new passphrase (`SetWorkspacePassphrase`, admin only).
   */
  public async setWorkspaceEncryption(input: CloudWorkspacePassphraseInput): Promise<CloudSyncStatus> {
    const mode = this.storedEncryptionMode(input.workspaceId)
    if (mode === "none") {
      // The server enforces encryption_mode write-once: a plaintext row can
      // never be upgraded, so refuse here rather than fail on the wire.
      throw new CloudWorkspaceEncryptionSettledError()
    }
    if (this.repository.getWorkspaceBinding(input.workspaceId) !== undefined) {
      // Already provisioned: `EnsureSyncWorkspace` never applies a bundle to an
      // existing row, so minting one here would seal every record under a key
      // the server does not hold. With no recorded mode there is nothing to
      // rewrap either — unlocking is what asks the server for the truth.
      if (mode === undefined) {
        throw new CloudWorkspaceLockedError()
      }
      return this.changeWorkspacePassphrase(input)
    }
    const { bundle, wdek } = createEncryptionBundle(input.passphrase)
    // Decision and bundle land together, before any network call: a crash
    // between here and provisioning leaves the choice made and the bundle
    // reusable, so the retry sends the byte-identical one.
    this.settings.set(KEY_ENCRYPTION_MODE_PREFIX + input.workspaceId, "e2ee")
    this.settings.set(KEY_ENCRYPTION_PENDING_PREFIX + input.workspaceId, JSON.stringify(bundle))
    this.acceptWorkspaceKey(input.workspaceId, wdek)
    try {
      await this.reconcileAfterDecision()
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  /**
   * Choose NO encryption for a workspace, releasing it from the pending gate.
   * Irreversible once the cloud row exists — that is the server's rule, not
   * ours — so it is a separate, explicit call rather than a default.
   */
  public async declineWorkspaceEncryption(input: CloudWorkspaceRefInput): Promise<CloudSyncStatus> {
    if (this.storedEncryptionMode(input.workspaceId) === "e2ee") {
      throw new CloudWorkspaceEncryptionSettledError()
    }
    this.recordEncryptionMode(input.workspaceId, "none")
    try {
      await this.reconcileAfterDecision()
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  /**
   * Unlock an encrypted workspace so sync can resume.
   *
   * The KEK is derived with the SERVER's stored salt and parameters, never the
   * current defaults, and the recovered key's fingerprint must match the one
   * the server names before it is accepted — so a passphrase that happens to
   * unwrap something cannot silently install the wrong key.
   */
  public async unlockWorkspace(input: CloudWorkspacePassphraseInput): Promise<CloudSyncStatus> {
    const binding = this.repository.getWorkspaceBinding(input.workspaceId)
    if (binding === undefined || this.activeConfig === null) {
      throw new Error("Cloud workspace binding is unavailable")
    }
    try {
      const record = await this.createClient(this.activeConfig)
        .getWorkspaceEncryption(binding.cloudWorkspaceId)
      if (record.mode !== "e2ee") {
        // Authoritative answer: record it (a plaintext workspace stops being
        // treated as locked) and there is nothing to unlock.
        this.recordEncryptionMode(input.workspaceId, record.mode)
        return this.status()
      }
      this.recordEncryptionMode(input.workspaceId, "e2ee")
      this.acceptWorkspaceKey(input.workspaceId, openEncryptionBundle(record, input.passphrase))
      return this.status()
    } finally {
      this.notifyStatusChanged()
    }
  }

  /** Forget an unlocked key, here and in the OS keychain. */
  public lockWorkspace(input: CloudWorkspaceRefInput): CloudSyncStatus {
    clearCachedWdek(this.settings, input.workspaceId)
    // Re-registered as locked, NOT unregistered: an unregistered workspace
    // reads as plaintext to the transport, which would push its records in the
    // clear on the very next cycle.
    registerWorkspaceKey(input.workspaceId, null)
    this.notifyStatusChanged()
    return this.status()
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
      try {
        this.teamCatalog = (await this.createClient(config).listSyncTeams()).teams.map(toTeamCatalogEntry)
        this.repository.setSetting(KEY_TEAM_CATALOG, JSON.stringify(this.teamCatalog))
      } catch {
        this.teamCatalog = []
        this.repository.deleteSetting(KEY_TEAM_CATALOG)
      }
      this.activateIfReady(false, true)
      // Link once, everything syncs: provision local-only workspaces, download
      // accessible cloud-only ones, pair Personal — no manual binding.
      await this.reconcile()
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

    // Opt-in only, and never the default: the local database is the source of
    // truth for locally-authored workspaces, so a routine disconnect must not
    // destroy them. When the user explicitly asks, every workspace stamped with
    // this account goes — workflows, runs and secrets cascade with it.
    const purgeAccountId = input.purgeLocalData === true
      ? this.loadAccountIdentity()?.accountId
      : undefined

    for (const binding of this.repository.listWorkspaceBindings()) {
      this.forgetWorkspaceEncryption(binding.workspaceId)
    }
    unregisterWorkspaceKey()
    this.repository.transaction((repository) => {
      this.tokenStore.clearTokens()
      if (purgeAccountId !== undefined) {
        const removed = repository.purgeAccountWorkspaces(purgeAccountId)
        cloudSyncControlLog.info(`purged ${removed} workspace(s) on disconnect`)
      }
      repository.clearCloudDeviceState()
      repository.deleteSetting(KEY_WORKSPACE_CATALOG)
      repository.deleteSetting(KEY_TEAM_CATALOG)
      repository.deleteSetting(KEY_PUBLIC_CONFIG)
      repository.deleteSetting(KEY_ACCOUNT_IDENTITY)
      repository.deleteSetting(KEY_AUTHENTICATION_REQUIRED)
    })
    this.activeConfig = null
    this.workspaceCatalog = []
    this.teamCatalog = []
    setState("idle")
    this.notifyStatusChanged()
    return this.status()
  }

  public async bindWorkspace(input: CloudBindWorkspaceInput): Promise<CloudSyncStatus> {
    const deviceId = this.requireLinkedDeviceId()
    const target = this.resolveBindTarget(input)
    const account = this.resolveBindAccount(input.workspaceId)
    const binding = this.firstSyncService.bindAndSnapshot({
      workspaceId: input.workspaceId,
      cloudWorkspaceId: input.cloudWorkspaceId,
      cloudWorkspaceName: target.workspaceName,
      ...(target.teamId !== undefined ? { teamId: target.teamId } : {}),
      ...(target.teamName !== undefined ? { teamName: target.teamName } : {}),
      syncMode: input.syncMode ?? "bi-directional",
      deviceId,
      accountId: account.accountId,
    })
    this.recordEncryptionMode(input.workspaceId, target.encryptionMode ?? "unspecified")
    this.activateIfReady(false, true)
    const provider = this.requireActiveProvider()
    void provider.initializeWorkspace(binding.workspaceId)
      .catch(() => undefined)
      .finally(() => this.notifyStatusChanged())
    this.notifyStatusChanged()
    return this.status()
  }

  private requireLinkedDeviceId(): string {
    const deviceId = this.tokenStore.getDeviceId()
    if (deviceId === undefined || !this.tokenStore.hasTokens()) {
      throw new Error("Cloud account must be linked before binding a workspace")
    }
    return deviceId
  }

  private resolveBindTarget(input: CloudBindWorkspaceInput): CloudWorkspaceCatalogEntry {
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
    return target
  }

  private resolveBindAccount(workspaceId: string): CloudAccountIdentity {
    const account = this.loadAccountIdentity()
    if (account === undefined) {
      throw new CloudAccountIdentityRequiredError()
    }
    // Same ownership rule the reconciler enforces, applied to the manual path:
    // a workspace holding another account's data is never pushed to this one.
    const owner = this.repository.getWorkspaceAccountId(workspaceId)
    if (!isWorkspaceClaimable(owner, account.accountId)) {
      throw new CloudWorkspaceOwnedByAnotherAccountError()
    }
    return account
  }

  public async createTeamWorkspace(input: CloudCreateTeamWorkspaceInput): Promise<Workspace> {
    const deviceId = this.tokenStore.getDeviceId()
    if (deviceId === undefined || !this.tokenStore.hasTokens() || this.activeConfig === null) {
      throw new Error("Connect APIWeave Cloud before creating a Team workspace")
    }
    const account = this.loadAccountIdentity()
    if (account === undefined) {
      throw new CloudAccountIdentityRequiredError()
    }

    const client = this.createClient(this.activeConfig)
    const team = await this.resolveTeamForCreation(input, client)

    const localSlug = this.uniqueLocalSlug(input.slug)
    const encryption = input.passphrase === undefined
      ? undefined
      : createEncryptionBundle(input.passphrase)
    const provisioned = await client.createSyncWorkspace({
      requestId: generateId(),
      teamId: team.teamId,
      name: input.name,
      slug: localSlug,
      ...(encryption !== undefined ? { encryption: encryption.bundle } : {}),
    })
    const catalogEntry = toCatalogEntry(provisioned)
    const local = new WorkspaceRepository(this.options.store).createWithId({
      id: catalogEntry.workspaceId,
      name: input.name,
      slug: localSlug,
      description: input.description ?? null,
      isPersonal: false,
      origin: "team",
      syncMode: "none",
    })
    this.firstSyncService.bindAndSnapshot({
      workspaceId: local.workspaceId,
      cloudWorkspaceId: catalogEntry.workspaceId,
      cloudWorkspaceName: catalogEntry.workspaceName,
      teamId: team.teamId,
      teamName: team.teamName,
      syncMode: "bi-directional",
      deviceId,
      accountId: account.accountId,
    })
    this.adoptCreatedWorkspaceKey(local.workspaceId, encryptionModeOf(provisioned.encryptionMode), encryption?.wdek)
    this.workspaceCatalog = [
      ...this.workspaceCatalog.filter((entry) => entry.workspaceId !== catalogEntry.workspaceId),
      catalogEntry,
    ]
    this.repository.setSetting(KEY_WORKSPACE_CATALOG, JSON.stringify(this.workspaceCatalog))
    this.activateIfReady(false, true)
    void this.requireActiveProvider().initializeWorkspace(local.workspaceId)
      .catch(() => undefined)
      .finally(() => this.notifyStatusChanged())
    this.notifyStatusChanged()
    return local
  }

  public unbindWorkspace(input: CloudUnbindWorkspaceInput): CloudSyncStatus {
    this.repository.removeWorkspaceBinding(input.workspaceId)
    this.forgetWorkspaceEncryption(input.workspaceId)
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
      const client = this.createClient(this.activeConfig)
      const [workspaces, teamResponse] = await Promise.all([
        client.listSyncWorkspaces(),
        client.listSyncTeams(),
      ])
      const catalog = workspaces.map(toCatalogEntry)
      const teams = teamResponse.teams.map(toTeamCatalogEntry)
      this.repository.setSetting(KEY_WORKSPACE_CATALOG, JSON.stringify(catalog))
      this.repository.setSetting(KEY_TEAM_CATALOG, JSON.stringify(teams))
      this.workspaceCatalog = catalog
      this.teamCatalog = teams
      await this.reconcile()
      setState("idle")
      return this.status()
    } catch (error) {
      setState(error instanceof ErrCloudOffline ? "offline" : "error")
      throw error
    } finally {
      this.notifyStatusChanged()
    }
  }

  /**
   * Hook for the workspace service: a workspace was just created locally. When
   * cloud is linked, reconcile it (provision + bind + push). No-op when
   * unlinked. Fire-and-forget — local creation must not block on the network.
   */
  public syncNewWorkspace(): void {
    if (!this.tokenStore.hasTokens() || this.activeConfig === null) {
      return
    }
    void this.reconcile()
      .catch(() => undefined)
      .finally(() => this.notifyStatusChanged())
  }

  /**
   * The failed changes for a workspace, each named. Read-only and deliberately
   * separate from `status()`: status is polled on every cloud event, and the
   * details are only wanted when the user opens them.
   */
  public listFailedRecords(input: CloudDeadLetterInput): readonly CloudFailedRecord[] {
    if (this.repository.getWorkspaceBinding(input.workspaceId) === undefined) {
      throw new Error("Cloud workspace binding is unavailable")
    }
    return this.repository.listDeadLetterOutbox(input.workspaceId)
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
      resolveConflict: async ({ conflict_id, winner, resolutions }) => {
        if (this.activeConfig === null) {
          throw new Error("Cloud configuration is unavailable")
        }
        const response = await this.createClient(this.activeConfig).resolveConflict(conflict_id, winner, resolutions)
        return { resultingRev: Number(response.resultingRev), winnerPayload: response.winnerPayload }
      },
      // Best-effort convergence accelerator: push (flush a keep-local/merged
      // re-push) then pull, so the resolution settles now instead of on the
      // next periodic sync. Fire-and-forget — the periodic sync is the
      // guarantee, so any error (no active provider, offline, transient) is
      // swallowed and retried on the next cycle.
      nudgeSync: () => {
        void this.push()
          .then(() => this.pull())
          .catch(() => {})
      },
    }
  }

  /**
   * Reconcile local ↔ cloud workspaces. Guarded by a single in-flight promise so
   * concurrent link/refresh/create triggers coalesce and it is safe to re-run.
   */
  private async reconcile(): Promise<void> {
    if (this.reconcileInFlight !== null) {
      return this.reconcileInFlight
    }
    const run = this.runReconcile()
    this.reconcileInFlight = run
    try {
      await run
    } finally {
      if (this.reconcileInFlight === run) {
        this.reconcileInFlight = null
      }
    }
  }

  /**
   * Reconcile in a pass that STARTED after the encryption decision was written.
   * The coalescing above is wrong here: a pass already in flight — `syncNewWorkspace`
   * fires one on every local creation — read this workspace's plan while it was
   * still `pending`, so awaiting it would report success for a workspace it
   * never provisioned. Settle that pass first (its outcome is not ours to
   * report), then reconcile; concurrent deciders still share the one follow-up.
   */
  private async reconcileAfterDecision(): Promise<void> {
    await this.reconcileInFlight?.catch(() => undefined)
    await this.reconcile()
  }

  private async runReconcile(): Promise<void> {
    const deviceId = this.tokenStore.getDeviceId()
    if (deviceId === undefined || !this.tokenStore.hasTokens() || this.activeConfig === null) {
      return
    }
    // Binding stamps the owning account, so reconciling without a known
    // identity would leave workspaces unowned — and therefore claimable by
    // whichever account links next. Bail instead.
    const account = this.loadAccountIdentity()
    if (account === undefined) {
      cloudReconcileLog.warn("skipped: cloud account identity is unavailable")
      return
    }
    // Already-bound workspaces get their mode refreshed from the freshly
    // fetched catalog, so a binding created before E2EE existed (mode unknown,
    // therefore locked) heals on the next link or catalog refresh without an
    // extra round trip.
    // A device upgrading from a pre-E2EE build has no recorded mode for its
    // bindings, so `backfillEncryptionModes` fires one refresh at launch to
    // land here without the user asking.
    const catalogModes = new Map(this.workspaceCatalog.map((entry) => [entry.workspaceId, entry.encryptionMode]))
    for (const binding of this.repository.listWorkspaceBindings()) {
      this.recordEncryptionMode(binding.workspaceId, catalogModes.get(binding.cloudWorkspaceId) ?? "unspecified")
    }

    const client = this.createClient(this.activeConfig)
    await reconcileWorkspaces({
      accountId: account.accountId,
      listLocalWorkspaces: () => {
        const owners = this.repository.listWorkspaceAccounts()
        return new WorkspaceRepository(this.options.store)
          .listAll()
          .filter((workspace) => workspace.deletedAt === null)
          .map((workspace) => {
            const ownerAccountId = owners.get(workspace.workspaceId)
            return {
              workspaceId: workspace.workspaceId,
              name: workspace.name,
              slug: workspace.slug,
              isPersonal: workspace.isPersonal,
              ...(ownerAccountId !== undefined ? { ownerAccountId } : {}),
            }
          })
      },
      listBoundPairs: () =>
        this.repository.listWorkspaceBindings().map((binding) => ({
          workspaceId: binding.workspaceId,
          cloudWorkspaceId: binding.cloudWorkspaceId,
        })),
      catalog: () => this.workspaceCatalog as readonly ReconcilerCatalogEntry[],
      encryptionPlan: (workspaceId) => this.encryptionPlan(workspaceId),
      ensureSyncWorkspace: async (input) => toCatalogEntry(await client.ensureSyncWorkspace(input)),
      createLocalFromCloud: (input) => {
        new WorkspaceRepository(this.options.store).createWithId({
          id: input.id,
          name: input.name,
          slug: input.slug,
          isPersonal: input.isPersonal,
          origin: input.origin,
        })
      },
      bind: (input: ReconcilerBindInput) => {
        this.firstSyncService.bindAndSnapshot({
          workspaceId: input.workspaceId,
          cloudWorkspaceId: input.cloudWorkspaceId,
          cloudWorkspaceName: input.cloudWorkspaceName,
          ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
          ...(input.teamName !== undefined ? { teamName: input.teamName } : {}),
          syncMode: "bi-directional",
          deviceId,
          accountId: account.accountId,
          recordBaseline: input.recordBaseline,
        })
        // Recorded from the SERVER's answer, in the same step that creates the
        // binding, so the workspace is classified before `reactivate()` builds
        // the provider and before any row is pushed.
        this.recordEncryptionMode(input.workspaceId, input.encryptionMode)
      },
      reactivate: () => this.activateIfReady(false, true),
      initializeWorkspace: (workspaceId) => this.requireActiveProvider().initializeWorkspace(workspaceId),
      log: (message, data) => cloudReconcileLog.info(message, data ? JSON.stringify(data) : ""),
    })
    this.notifyStatusChanged()
  }

  private activateIfReady(resumePending = false, replace = false): void {
    if (this.deactivateForReplaceOrSkip(replace)) {
      return
    }
    const workspaceBindings = this.repository.listWorkspaceBindings()
    const config = this.resolveActivationConfig(workspaceBindings)
    if (config === undefined) {
      if (replace) {
        this.options.setSyncProviderTarget(new LocalOnlySyncProvider())
        setState("idle")
      }
      return
    }

    // BEFORE the provider exists: the transport reads the key registry on its
    // very first push, and an unregistered e2ee workspace pushes plaintext.
    this.registerWorkspaceKeys(workspaceBindings)
    const provider = this.createActiveProvider(config, workspaceBindings)
    if (resumePending && workspaceBindings.some((binding) => binding.initializationState !== "initialized")) {
      void provider.resumePendingInitializations().catch(() => undefined)
    }
  }

  /** True when activation should stop here: already active and not replacing. */
  private deactivateForReplaceOrSkip(replace: boolean): boolean {
    if (this.activeProvider !== null && !replace) {
      return true
    }
    if (replace && this.activeProvider !== null) {
      this.activeProvider.deactivate()
      this.activeProvider = null
    }
    return false
  }

  private resolveActivationConfig(
    workspaceBindings: readonly CloudWorkspaceBinding[],
  ): DesktopCloudConfig | undefined {
    if (!this.tokenStore.hasTokens() || workspaceBindings.length === 0 || this.activeConfig === null) {
      return undefined
    }
    return this.activeConfig
  }

  private createActiveProvider(
    config: DesktopCloudConfig,
    workspaceBindings: readonly CloudWorkspaceBinding[],
  ): CloudSyncProvider {
    const client = this.createClient(config)
    const provider = new CloudSyncProvider(client, this.tokenStore, this.repository, {
      workspaceBindings,
    }, (state) => {
      setState(state)
      this.notifyStatusChanged()
    })
    this.activeProvider = provider
    this.options.setSyncProviderTarget(provider)
    setState(this.repository.countDeadLetterOutbox() > 0 ? "error" : "idle")
    return provider
  }

  /**
   * A device upgrading from a pre-E2EE build holds a catalog serialized
   * without `encryptionMode`, so every bound workspace reads as unknown —
   * therefore locked, therefore never pushed — until the user refreshes by
   * hand. One catalog fetch at launch heals that.
   *
   * ponytail: once per process, at construction, and silent on failure — an
   * offline device stays locked and heals on the next refresh, which is
   * exactly today's behaviour.
   */
  private backfillEncryptionModes(): void {
    // A provider exists only when tokens, config and bindings all do, which
    // is precisely when a refresh can run and has something to fix.
    if (this.activeProvider === null) {
      return
    }
    const unknown = this.repository.listWorkspaceBindings()
      .some((binding) => this.storedEncryptionMode(binding.workspaceId) === undefined)
    if (unknown) {
      void this.refreshWorkspaceCatalog().catch(() => undefined)
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

  private loadTeamCatalog(): readonly CloudTeamCatalogEntry[] {
    const value = this.repository.getSetting(KEY_TEAM_CATALOG)
    if (value === undefined) return []
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter(isTeamCatalogEntry) : []
    } catch {
      return []
    }
  }

  /** Resolve createTeamWorkspace's target team: create a new one, or validate the selected one. */
  private async resolveTeamForCreation(
    input: CloudCreateTeamWorkspaceInput,
    client: CloudClient,
  ): Promise<CloudTeamCatalogEntry> {
    if (input.newTeamName !== undefined) {
      const createdTeam = await client.createTeam(
        input.newTeamName,
        `${slugify(input.newTeamName)}-${generateId().slice(-8).toLowerCase()}`,
      )
      const team: CloudTeamCatalogEntry = {
        teamId: createdTeam.id,
        teamName: createdTeam.name,
        isPersonal: false,
        canCreateWorkspaces: true,
      }
      this.teamCatalog = [...this.teamCatalog, team]
      this.repository.setSetting(KEY_TEAM_CATALOG, JSON.stringify(this.teamCatalog))
      return team
    }
    const selectedTeam = this.teamCatalog.find((candidate) => candidate.teamId === input.teamId)
    if (selectedTeam === undefined) {
      throw new Error("The selected Team is no longer available")
    }
    if (selectedTeam.isPersonal || !selectedTeam.canCreateWorkspaces) {
      throw new Error("You do not have permission to create Workspaces in this Team")
    }
    return selectedTeam
  }

  private uniqueLocalSlug(source: string): string {
    const repository = new WorkspaceRepository(this.options.store)
    const base = slugify(source)
    let candidate = base
    let suffix = 2
    while (repository.getBySlug(candidate) !== undefined) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
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
    if (current === "offline" || current === "syncing" || current === "initializing") {
      return current
    }
    if (bindings.some((binding) => binding.lastError?.includes("ErrCloudOffline") === true)) {
      return "offline"
    }
    if (bindings.some((binding) => binding.lastError !== undefined)) {
      return "error"
    }
    if (bindings.some((binding) => binding.initializationState !== "initialized")) {
      return "initializing"
    }
    return current
  }

  /** The recorded mode, or `undefined` when the decision is still pending. */
  private storedEncryptionMode(workspaceId: string): "none" | "e2ee" | undefined {
    const value = this.settings.get(KEY_ENCRYPTION_MODE_PREFIX + workspaceId)
    return value === "none" || value === "e2ee" ? value : undefined
  }

  /**
   * Persist what the SERVER says a workspace's mode is, and make the transport
   * agree. `unspecified` is deliberately not persisted: it is the absence of an
   * answer, and recording it would be indistinguishable from recording `none`.
   */
  private recordEncryptionMode(workspaceId: string, mode: WorkspaceEncryptionMode): void {
    if (mode === "unspecified") {
      this.registerWorkspaceKeys([{ workspaceId }])
      return
    }
    this.settings.set(KEY_ENCRYPTION_MODE_PREFIX + workspaceId, mode)
    this.settings.delete(KEY_ENCRYPTION_PENDING_PREFIX + workspaceId)
    if (mode === "none") {
      // The server provisioned this workspace in the clear — including the case
      // where we asked for E2EE and `EnsureSyncWorkspace` ignored the bundle
      // because the row already existed. Drop the key we minted; keeping it
      // would seal records under a key the server does not know about.
      clearCachedWdek(this.settings, workspaceId)
    }
    this.registerWorkspaceKeys([{ workspaceId }])
  }

  /**
   * Classify a workspace `CreateSyncWorkspace` just created, off the mode in
   * its RESPONSE and never off what we asked for. The bundle is derived once
   * per call and reused by `CloudClient`'s post-refresh retry, which is what
   * the server's byte-identical-per-request_id rule requires — re-deriving here
   * would fail the retry `ALREADY_EXISTS`.
   */
  private adoptCreatedWorkspaceKey(
    workspaceId: string,
    mode: WorkspaceEncryptionMode,
    wdek: Uint8Array | undefined,
  ): void {
    if (mode === "e2ee" && wdek !== undefined) {
      this.acceptWorkspaceKey(workspaceId, wdek)
    }
    this.recordEncryptionMode(workspaceId, mode)
  }

  /** Cache a freshly recovered or freshly minted WDEK and hand it to the transport. */
  private acceptWorkspaceKey(workspaceId: string, wdek: Uint8Array): void {
    const refusal = cacheWdek(this.settings, workspaceId, wdek)
    if (refusal !== null) {
      // Not fatal: the key still works for this session, the user is just asked
      // again next launch. Never a reason to skip registering it.
      cloudSyncControlLog.warn(`workspace key not cached: ${refusal}`)
    }
    registerWorkspaceKey(workspaceId, wdek)
  }

  /**
   * Tell the transport what every bound workspace's key situation is. MUST run
   * before the provider is built, because an unregistered workspace is treated
   * as plaintext and would push in the clear on the first cycle.
   *
   * This is also the launch unlock path: an e2ee workspace whose WDEK is in the
   * OS keychain comes back unlocked, and one whose cache is missing (another
   * machine, cleared keychain, a Linux box with no keyring) is registered
   * `null` — locked, surfaced in `status()`, and not pushed.
   */
  private registerWorkspaceKeys(bindings: readonly { readonly workspaceId: string }[]): void {
    for (const binding of bindings) {
      const mode = this.storedEncryptionMode(binding.workspaceId)
      if (mode === "none") {
        unregisterWorkspaceKey(binding.workspaceId)
        continue
      }
      // A key unlocked this session is authoritative over the cache: `cacheWdek`
      // refuses to store on a keyring-less box, so re-reading here would re-lock
      // a workspace whose passphrase was just typed. This runs on every reconcile.
      if (mode === "e2ee" && hasWorkspaceKey(binding.workspaceId)) {
        continue
      }
      // Unknown mode registers as LOCKED, never as plaintext: the workspace may
      // be e2ee and we simply have not been told, and guessing plaintext there
      // is unrecoverable. It resolves on the next catalog refresh or unlock.
      registerWorkspaceKey(
        binding.workspaceId,
        mode === "e2ee" ? readCachedWdek(this.settings, binding.workspaceId) ?? null : null,
      )
    }
  }

  private encryptionStateOf(workspaceId: string): CloudWorkspaceEncryptionState {
    const mode = this.storedEncryptionMode(workspaceId)
    if (mode === "none") return "plaintext"
    if (mode === undefined) return "unknown"
    return hasWorkspaceKey(workspaceId) ? "unlocked" : "locked"
  }

  /**
   * Local workspaces the reconciler is holding back for want of an encryption
   * decision — the renderer's cue to prompt. A workspace leaves this list by
   * `setWorkspaceEncryption` or `declineWorkspaceEncryption`.
   *
   * Only workspaces the reconciler would actually claim: the recorded mode is
   * write-once, so prompting about another account's workspace would let this
   * user commit it to plaintext forever, for a sync that can never happen here.
   */
  private pendingEncryptionDecisions(
    bindings: readonly CloudWorkspaceBindingStatus[],
  ): readonly CloudPendingEncryptionDecision[] {
    // `runReconcile` bails outright without an identity, so nothing is pending.
    const accountId = this.loadAccountIdentity()?.accountId
    if (accountId === undefined) {
      return []
    }
    const bound = new Set(bindings.map((binding) => binding.workspaceId))
    const owners = this.repository.listWorkspaceAccounts()
    return new WorkspaceRepository(this.options.store)
      .listAll()
      .filter((workspace) =>
        workspace.deletedAt === null
        && !bound.has(workspace.workspaceId)
        && isWorkspaceClaimable(owners.get(workspace.workspaceId), accountId)
        && this.storedEncryptionMode(workspace.workspaceId) === undefined)
      .map((workspace) => ({ workspaceId: workspace.workspaceId, workspaceName: workspace.name }))
  }

  /** The decision recorded for a workspace that has not been provisioned yet. */
  private encryptionPlan(workspaceId: string): ReconcilerEncryptionPlan {
    const mode = this.storedEncryptionMode(workspaceId)
    if (mode === "none") {
      return { mode: "none" }
    }
    const stored = mode === "e2ee"
      ? this.settings.get(KEY_ENCRYPTION_PENDING_PREFIX + workspaceId)
      : undefined
    if (stored === undefined) {
      return { mode: "pending" }
    }
    try {
      return { mode: "e2ee", bundle: JSON.parse(stored) as WorkspaceEncryptionBundle }
    } catch {
      return { mode: "pending" }
    }
  }

  /** Re-wrap the workspace's existing key under a new passphrase. Admin only, server-side. */
  private async changeWorkspacePassphrase(input: CloudWorkspacePassphraseInput): Promise<CloudSyncStatus> {
    const binding = this.repository.getWorkspaceBinding(input.workspaceId)
    // The held key first, the cache only as a fallback: `encryptionStateOf`
    // reports "unlocked" off `hasWorkspaceKey`, and that is what renders this
    // button — but `cacheWdek` refuses to store on a keyring-less box, so
    // reading the cache would reject a workspace the same screen calls unlocked.
    const wdek = hasWorkspaceKey(input.workspaceId)
      ? workspaceWdek(input.workspaceId) ?? undefined
      : readCachedWdek(this.settings, input.workspaceId)
    if (binding === undefined || this.activeConfig === null || wdek === undefined) {
      // Rewrapping needs the current key. Without it there is nothing to
      // re-wrap — unlock first, which is a strictly better error than wiping
      // the workspace's key and stranding its data.
      throw new CloudWorkspaceLockedError()
    }
    const bundle = rewrapBundle(wdek, input.passphrase)
    try {
      await this.createClient(this.activeConfig).setWorkspacePassphrase(binding.cloudWorkspaceId, bundle)
      this.acceptWorkspaceKey(input.workspaceId, wdek)
      return this.status()
    } catch (error) {
      throw setPassphraseFailure(error)
    } finally {
      this.notifyStatusChanged()
    }
  }

  /**
   * Drop every trace of a workspace's encryption: the cached key, the recorded
   * mode and the pending bundle. Called on unbind and disconnect — the key is
   * account-scoped material and must not outlive the link. Rebinding re-reads
   * the mode from the server and re-prompts for the passphrase.
   */
  private forgetWorkspaceEncryption(workspaceId: string): void {
    clearCachedWdek(this.settings, workspaceId)
    this.settings.delete(KEY_ENCRYPTION_MODE_PREFIX + workspaceId)
    this.settings.delete(KEY_ENCRYPTION_PENDING_PREFIX + workspaceId)
    unregisterWorkspaceKey(workspaceId)
  }

  private notifyStatusChanged(): void {
    this.options.onStatusChanged?.()
  }
}

/**
 * Name the two ways the server refuses `SetWorkspacePassphrase`, so the seam can
 * say which one happened instead of forwarding "Connect call failed — HTTP 403".
 *
 * `ErrCloudRequestFailed` carries the HTTP status Connect derived from the
 * handler's error code (connect-go's connectCodeToHTTP): PermissionDenied → 403
 * for the admin-only check, and FailedPrecondition → 400, which this endpoint
 * returns when the update matches zero rows because the stored
 * `wdek_fingerprint` is not the one this device just wrapped.
 */
function setPassphraseFailure(error: unknown): unknown {
  if (!(error instanceof ErrCloudRequestFailed)) return error
  if (error.status === 403) return new CloudWorkspacePassphraseAdminOnlyError()
  if (error.status === 400) {
    return new CloudWorkspaceEncryptionInvalidError("the key stored in the cloud is not the one this device holds")
  }
  return error
}

export function cloudDefaults(version: string): DesktopCloudSyncDefaults {
  return {
    cloudEntryUrl: process.env["APIWEAVE_CLOUD_ENTRY_URL"] ?? CANONICAL_CLOUD_ENTRY_URL,
    clientVersion: version,
    deviceLabel: `${hostname() || "APIWeave Desktop"}`,
  }
}

function toCatalogEntry(
  workspace: import("@apiweave/proto/apiweave/v1/device_pb").SyncWorkspace,
): CloudWorkspaceCatalogEntry {
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
    encryptionMode: encryptionModeOf(workspace.encryptionMode),
  }
}

function toTeamCatalogEntry(team: import("@apiweave/proto/apiweave/v1/device_pb").SyncTeam): CloudTeamCatalogEntry {
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    isPersonal: team.isPersonal,
    canCreateWorkspaces: team.capabilities?.canCreateWorkspaces ?? false,
  }
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function hasRequiredCatalogFields(entry: Record<string, unknown>): boolean {
  return typeof entry["workspaceId"] === "string"
    && typeof entry["workspaceName"] === "string"
    && typeof entry["isPersonal"] === "boolean"
    && typeof entry["effectiveRole"] === "number"
    && typeof entry["canPull"] === "boolean"
    && typeof entry["canPush"] === "boolean"
    && typeof entry["canResolveConflicts"] === "boolean"
}

function hasOptionalCatalogFields(entry: Record<string, unknown>): boolean {
  return isOptionalString(entry["teamId"])
    && isOptionalString(entry["teamName"])
    && isOptionalString(entry["encryptionMode"])
}

function isCatalogEntry(value: unknown): value is CloudWorkspaceCatalogEntry {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  return hasRequiredCatalogFields(entry) && hasOptionalCatalogFields(entry)
}

function isTeamCatalogEntry(value: unknown): value is CloudTeamCatalogEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry["teamId"] === "string"
    && typeof entry["teamName"] === "string"
    && typeof entry["isPersonal"] === "boolean"
    && typeof entry["canCreateWorkspaces"] === "boolean"
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "team"
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
