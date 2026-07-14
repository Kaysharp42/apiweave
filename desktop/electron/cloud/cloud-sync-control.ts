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
} from "../../core/services/cloud_sync_control"
import { LocalOnlySyncProvider } from "../../core/sync"
import { cancelDeviceLink, startDeviceLink } from "./cloud-link"
import { CloudClient, DeviceTokenStore } from "./cloud-client"
import { CloudSyncProvider } from "./cloud-transport"
import { getState, setState } from "./cloud-state"

interface DesktopCloudSyncDefaults {
  readonly zitadelIssuer: string
  readonly desktopClientId: string
  readonly apiBaseUrl: string
  readonly clientVersion: string
  readonly deviceLabel: string
}

export interface DesktopCloudSyncControlOptions {
  readonly store: KVStore
  readonly keyfilePath: string
  readonly defaults: DesktopCloudSyncDefaults
  readonly setSyncProviderTarget: (provider: SyncProvider) => void
}

export class DesktopCloudSyncControl implements CloudSyncControl {
  private readonly repository: CloudSyncRepository
  private readonly tokenStore: DeviceTokenStore
  private activeProvider: CloudSyncProvider | null = null
  private activeConfig: DesktopCloudSyncDefaults

  public constructor(private readonly options: DesktopCloudSyncControlOptions) {
    this.repository = new CloudSyncRepository(options.store)
    this.tokenStore = new DeviceTokenStore(this.repository, options.keyfilePath)
    this.activeConfig = options.defaults
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
    }
  }

  public async link(input: CloudLinkInput): Promise<CloudSyncStatus> {
    const config = this.mergeConfig(input)
    const result = await startDeviceLink({
      zitadelIssuer: config.zitadelIssuer,
      desktopClientId: config.desktopClientId,
      apiBaseUrl: config.apiBaseUrl,
      keyfilePath: this.options.keyfilePath,
      deviceLabel: config.deviceLabel,
      devicePublicKey: makeDevicePublicKey(),
      clientVersion: config.clientVersion,
    })

    this.tokenStore.setEncryptedTokens(
      result.device.deviceId,
      result.accessToken,
      result.encryptedRefreshToken,
      result.wrappedDek,
    )
    this.repository.upsertDevice({
      deviceId: result.device.deviceId,
      label: result.device.label,
      clientVersion: result.device.clientVersion,
      publicKey: result.device.publicKey,
      createdAt: result.device.createdAt,
    })

    for (const workspaceId of input.workspaceIds ?? []) {
      this.repository.upsertWorkspaceBinding({
        workspaceId,
        cloudWorkspaceId: workspaceId,
        syncMode: "bi-directional",
        deviceId: result.device.deviceId,
      })
    }

    this.activeConfig = config
    this.activateIfReady()
    return this.status()
  }

  public cancelLink(): CloudSyncStatus {
    cancelDeviceLink()
    return this.status()
  }

  public unlink(): CloudSyncStatus {
    cancelDeviceLink()
    this.tokenStore.clearTokens()
    this.repository.clearCloudDeviceState()
    this.activeProvider = null
    this.options.setSyncProviderTarget(new LocalOnlySyncProvider())
    setState("idle")
    return this.status()
  }

  public bindWorkspace(input: CloudBindWorkspaceInput): CloudSyncStatus {
    const deviceId = this.tokenStore.getDeviceId()
    this.repository.upsertWorkspaceBinding({
      workspaceId: input.workspaceId,
      cloudWorkspaceId: input.cloudWorkspaceId ?? input.workspaceId,
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

  private mergeConfig(input: CloudLinkInput): DesktopCloudSyncDefaults {
    return {
      zitadelIssuer: input.zitadelIssuer ?? this.options.defaults.zitadelIssuer,
      desktopClientId: input.desktopClientId ?? this.options.defaults.desktopClientId,
      apiBaseUrl: input.apiBaseUrl ?? this.options.defaults.apiBaseUrl,
      clientVersion: this.options.defaults.clientVersion,
      deviceLabel: input.deviceLabel ?? this.options.defaults.deviceLabel,
    }
  }

  private activateIfReady(): void {
    const workspaceBindings = this.repository.listWorkspaceBindings()
    if (!this.tokenStore.hasTokens() || workspaceBindings.length === 0) {
      return
    }

    const client = new CloudClient(
      { baseUrl: this.activeConfig.apiBaseUrl, clientVersion: this.activeConfig.clientVersion },
      this.tokenStore,
    )
    const provider = new CloudSyncProvider(client, this.tokenStore, this.options.store, {
      workspaceBindings,
      zitadelIssuer: this.activeConfig.zitadelIssuer,
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
}

export function cloudDefaults(version: string): DesktopCloudSyncDefaults {
  return {
    zitadelIssuer: process.env["APIWEAVE_CLOUD_ZITADEL_ISSUER"] ?? "https://zitadel.apiweave.cloud",
    desktopClientId: process.env["APIWEAVE_CLOUD_DESKTOP_CLIENT_ID"] ?? "apiweave-desktop",
    apiBaseUrl: process.env["APIWEAVE_CLOUD_API_BASE_URL"] ?? "https://api.apiweave.cloud",
    clientVersion: version,
    deviceLabel: `${hostname() || "APIWeave Desktop"}`,
  }
}

function makeDevicePublicKey(): Uint8Array {
  const publicKeyDer = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" })
  if (publicKeyDer.length >= 32) {
    return new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32))
  }
  return createHash("sha256").update(publicKeyDer).digest()
}
