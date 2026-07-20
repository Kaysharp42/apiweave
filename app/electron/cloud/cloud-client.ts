/**
 * Cloud client and device token store.
 *
 * DeviceTokenStore: manages encrypted tokens using the existing keyfile
 * infrastructure. Stores only the encrypted refresh token, wrapped DEK, and
 * device ID in app_settings. The opaque APIWeave session remains in memory.
 *
 * CloudClient: lightweight Connect protocol client for SyncService. Uses
 * fetch() to call the Connect endpoints. No external dependencies.
 */

import { readKeyfile } from "../../core/secrets/keyfile"
import { encrypt, decrypt, generateDek, wrapDek, unwrapDek, type EncryptedBlob } from "../../core/secrets/crypto"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository } from "../../core/repositories"
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import { UlidSchema } from "@apiweave/proto/apiweave/v1/common_pb"
import {
  DeviceService,
  EnsureSyncWorkspaceRequestSchema,
  RevokeDeviceRequestSchema,
  SyncWorkspaceListSchema,
  SyncWorkspaceSchema,
  type SyncWorkspace,
  type SyncWorkspaceList,
} from "@apiweave/proto/apiweave/v1/device_pb"
import {
  ConflictWinner,
  FetchLoserRequestSchema,
  FetchLoserResponseSchema,
  HelloRequestSchema,
  HelloResponseSchema,
  PullChangesRequestSchema,
  PullChangesResponseSchema,
  PushDeltaSchema,
  PushDeltasRequestSchema,
  PushDeltasResponseSchema,
  ResolveConflictRequestSchema,
  SyncService,
  type ChangeEnvelope,
  type FetchLoserResponse,
  type HelloRequest,
  type HelloResponse,
  type PullChangesRequest,
  type PullChangesResponse,
  type PushDelta,
  type PushDeltasRequest,
  type PushDeltasResponse,
} from "@apiweave/proto/apiweave/v1/sync_service_pb"

// ─── Device Token Store ──────────────────────────────────────────────────────

const KEY_DEVICE_ID = "cloud.device_id"
const KEY_ENCRYPTED_REFRESH = "cloud.encrypted_refresh"
const KEY_WRAPPED_DEK = "cloud.wrapped_dek"
const LEGACY_KEY_ACCESS_TOKEN = "cloud.access_token"

interface RefreshTokenContext {
  readonly value: string
  readonly rotate: (refreshToken: string) => void
  readonly setAccessToken: (accessToken: string) => void
}

export class DeviceTokenStore {
  private readonly repository: CloudSyncRepository
  private sessionToken: string | undefined
  private generation = 0

  public constructor(
    store: KVStore | CloudSyncRepository,
    private readonly keyfilePath: string,
  ) {
    this.repository = store instanceof CloudSyncRepository ? store : new CloudSyncRepository(store)
    // App sessions were persisted by pre-production builds. They are opaque
    // bearer credentials and must not survive process restart.
    this.repository.deleteSetting(LEGACY_KEY_ACCESS_TOKEN)
  }

  public hasTokens(): boolean {
    return this.repository.getSetting(KEY_DEVICE_ID) !== undefined
  }

  public getDeviceId(): string | undefined {
    return this.repository.getSetting(KEY_DEVICE_ID)
  }

  public getAccessToken(): string | undefined {
    return this.sessionToken
  }

  public getRefreshToken(): string | undefined {
    return this.loadRefreshToken()?.value
  }

  public loadRefreshToken(): RefreshTokenContext | undefined {
    const encryptedRefresh = this.repository.getSetting(KEY_ENCRYPTED_REFRESH)
    const wrappedDekValue = this.repository.getSetting(KEY_WRAPPED_DEK)
    if (encryptedRefresh === undefined || wrappedDekValue === undefined) {
      return undefined
    }

    const keyfile = readKeyfile(this.keyfilePath)
    const generation = this.generation
    const deviceId = this.getDeviceId()
    const wrappedDek = Buffer.from(wrappedDekValue, "base64")
    const dek = unwrapDek(new Uint8Array(wrappedDek), keyfile.masterKek)

    const blobJson = JSON.parse(encryptedRefresh) as {
      ciphertext: number[]
      nonce: number[]
      kekId: string
      algorithm: string
    }
    const blob: EncryptedBlob = {
      ciphertext: new Uint8Array(blobJson.ciphertext),
      nonce: new Uint8Array(blobJson.nonce),
      kekId: blobJson.kekId,
      algorithm: blobJson.algorithm as "aes-256-gcm",
    }
    return {
      value: decrypt(blob, dek),
      rotate: (refreshToken) => {
        if (this.generation === generation && this.getDeviceId() === deviceId) {
          this.setRefreshTokenWithKek(refreshToken, keyfile.masterKek)
        }
      },
      setAccessToken: (accessToken) => {
        if (this.generation === generation && this.getDeviceId() === deviceId) {
          this.sessionToken = accessToken
        }
      },
    }
  }

  public setTokens(deviceId: string, accessToken: string, refreshToken: string): void {
    this.generation += 1
    const encrypted = this.encryptRefreshToken(refreshToken)
    this.repository.transaction((repository) => {
      repository.setSetting(KEY_DEVICE_ID, deviceId)
      persistEncryptedRefreshToken(repository, encrypted.blob, encrypted.wrappedDek)
    })
    this.sessionToken = accessToken
  }

  public setEncryptedTokens(
    deviceId: string,
    encryptedRefreshToken: EncryptedBlob,
    wrappedDek: Uint8Array,
  ): void {
    this.generation += 1
    this.repository.transaction((repository) => {
      repository.setSetting(KEY_DEVICE_ID, deviceId)
      persistEncryptedRefreshToken(repository, encryptedRefreshToken, wrappedDek)
    })
  }

  public setAccessToken(accessToken: string): void {
    this.sessionToken = accessToken
  }

  public setRefreshToken(refreshToken: string): void {
    this.setRefreshTokenWithKek(refreshToken, readKeyfile(this.keyfilePath).masterKek)
  }

  private setRefreshTokenWithKek(refreshToken: string, masterKek: Uint8Array): void {
    const encrypted = this.encryptRefreshToken(refreshToken, masterKek)
    this.repository.transaction((repository) => {
      persistEncryptedRefreshToken(repository, encrypted.blob, encrypted.wrappedDek)
    })
  }

  public clearTokens(): void {
    this.generation += 1
    this.sessionToken = undefined
    this.repository.transaction((repository) => {
      repository.deleteSetting(KEY_DEVICE_ID)
      repository.deleteSetting(LEGACY_KEY_ACCESS_TOKEN)
      repository.deleteSetting(KEY_ENCRYPTED_REFRESH)
      repository.deleteSetting(KEY_WRAPPED_DEK)
    })
  }

  private encryptRefreshToken(
    refreshToken: string,
    masterKek = readKeyfile(this.keyfilePath).masterKek,
  ): { blob: EncryptedBlob; wrappedDek: Uint8Array } {
    const dek = generateDek()
    return {
      blob: encrypt(refreshToken, dek, "kek-desktop-link"),
      wrappedDek: wrapDek(dek, masterKek),
    }
  }
}

export function serializeEncryptedBlob(blob: EncryptedBlob): string {
  return JSON.stringify({
    ciphertext: Array.from(blob.ciphertext),
    nonce: Array.from(blob.nonce),
    kekId: blob.kekId,
    algorithm: blob.algorithm,
  })
}

function persistEncryptedRefreshToken(
  repository: CloudSyncRepository,
  encryptedRefreshToken: EncryptedBlob,
  wrappedDek: Uint8Array,
): void {
  repository.setSetting(KEY_ENCRYPTED_REFRESH, serializeEncryptedBlob(encryptedRefreshToken))
  repository.setSetting(KEY_WRAPPED_DEK, Buffer.from(wrappedDek).toString("base64"))
}

// ─── Cloud Client ────────────────────────────────────────────────────────────

export interface CloudClientConfig {
  readonly baseUrl: string
  readonly clientVersion: string
  readonly zitadelIssuer: string
  readonly clientId: string
}

export type { ChangeEnvelope, HelloResponse, PullChangesResponse, PushDelta, PushDeltasResponse }

export interface CloudPushDelta {
  readonly workspaceId: string
  readonly kind: PushDelta["kind"]
  readonly recordId: string
  readonly expectedRev: bigint
  readonly payload: Uint8Array
  readonly op: PushDelta["op"]
}

export class ErrUnauthorized extends Error {
  constructor() {
    super("unauthorized — token expired or invalid")
    this.name = "ErrUnauthorized"
  }
}

export class ErrCloudOffline extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error && cause.message.length > 0 ? cause.message : "Cloud service unavailable")
    this.name = "ErrCloudOffline"
  }
}

export class ErrProtocolMismatch extends Error {
  constructor(
    public readonly serverVersion: number,
    public readonly supportedVersions: number[],
  ) {
    super(`protocol mismatch: server=${serverVersion}, supported=${supportedVersions.join(",")}`)
    this.name = "ErrProtocolMismatch"
  }
}

interface DesktopSessionResponse {
  readonly sessionToken: string
  readonly expiresAt: string
}

export async function exchangeDesktopSession(
  apiBaseUrl: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/desktop/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
      ...(signal !== undefined ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted === true) {
      throw signal.reason
    }
    throw new ErrCloudOffline(error)
  }
  if (!response.ok) {
    throw new ErrUnauthorized()
  }
  let session: DesktopSessionResponse
  try {
    session = (await response.json()) as DesktopSessionResponse
  } catch {
    throw new ErrUnauthorized()
  }
  if (typeof session.sessionToken !== "string" || session.sessionToken.length === 0) {
    throw new ErrUnauthorized()
  }
  return session.sessionToken
}

const SUPPORTED_PROTOCOL_VERSIONS = [1]
const METHOD_HELLO = "Hello"
const METHOD_PULL_CHANGES = "PullChanges"
const METHOD_PUSH_DELTAS = "PushDeltas"
const METHOD_LIST_SYNC_WORKSPACES = "ListSyncWorkspaces"
const METHOD_ENSURE_SYNC_WORKSPACE = "EnsureSyncWorkspace"
const METHOD_REVOKE_DEVICE = "RevokeDevice"
const METHOD_RESOLVE_CONFLICT = "ResolveConflict"
const METHOD_FETCH_LOSER = "FetchLoser"

export interface CloudClientEvents {
  readonly onAuthenticationRequired?: () => void
  readonly onAuthenticated?: () => void
}

export class CloudClient {
  private refreshInFlight: Promise<void> | null = null

  public constructor(
    private readonly config: CloudClientConfig,
    private readonly tokenStore: DeviceTokenStore,
    private readonly events: CloudClientEvents = {},
  ) {}

  public async hello(): Promise<HelloResponse> {
    const request: HelloRequest = create(HelloRequestSchema, {
      clientVersion: this.config.clientVersion,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    })
    const json = await this.call(
      SyncService.typeName,
      METHOD_HELLO,
      toJson(HelloRequestSchema, request),
    )
    const response = fromJson(HelloResponseSchema, json, { ignoreUnknownFields: true })

    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(response.protocolVersion)) {
      throw new ErrProtocolMismatch(response.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS)
    }

    return response
  }

  public async pullChanges(workspaceId: string, cursor: bigint, pageSize: number): Promise<PullChangesResponse> {
    const request: PullChangesRequest = create(PullChangesRequestSchema, {
      deviceId: this.tokenStore.getDeviceId() ?? "",
      cursor,
      pageSize,
      workspaceId: create(UlidSchema, { value: workspaceId }),
    })
    const json = await this.call(
      SyncService.typeName,
      METHOD_PULL_CHANGES,
      toJson(PullChangesRequestSchema, request),
    )
    return fromJson(PullChangesResponseSchema, json, { ignoreUnknownFields: true })
  }

  public async pushDeltas(idempotencyKey: string, deltas: CloudPushDelta[]): Promise<PushDeltasResponse> {
    const request: PushDeltasRequest = create(PushDeltasRequestSchema, {
      deviceId: this.tokenStore.getDeviceId() ?? "",
      idempotencyKey,
      deltas: deltas.map((d) => create(PushDeltaSchema, {
        workspaceId: create(UlidSchema, { value: d.workspaceId }),
        kind: d.kind,
        recordId: d.recordId,
        expectedRev: d.expectedRev,
        payload: d.payload,
        op: d.op,
      })),
    })
    const json = await this.call(
      SyncService.typeName,
      METHOD_PUSH_DELTAS,
      toJson(PushDeltasRequestSchema, request),
    )
    return fromJson(PushDeltasResponseSchema, json, { ignoreUnknownFields: true })
  }

  public async listSyncWorkspaces(): Promise<SyncWorkspaceList> {
    const json = await this.call(
      DeviceService.typeName,
      METHOD_LIST_SYNC_WORKSPACES,
      toJson(EmptySchema, create(EmptySchema)),
    )
    return fromJson(SyncWorkspaceListSchema, json, { ignoreUnknownFields: true })
  }

  public async ensureSyncWorkspace(params: {
    workspaceId: string
    name: string
    slug: string
    isPersonal: boolean
  }): Promise<SyncWorkspace> {
    const request = create(EnsureSyncWorkspaceRequestSchema, {
      workspaceId: params.workspaceId,
      name: params.name,
      slug: params.slug,
      isPersonal: params.isPersonal,
    })
    const json = await this.call(
      DeviceService.typeName,
      METHOD_ENSURE_SYNC_WORKSPACE,
      toJson(EnsureSyncWorkspaceRequestSchema, request),
    )
    return fromJson(SyncWorkspaceSchema, json, { ignoreUnknownFields: true })
  }

  public async revokeDevice(deviceId: string): Promise<void> {
    const request = create(RevokeDeviceRequestSchema, { deviceId })
    await this.call(
      DeviceService.typeName,
      METHOD_REVOKE_DEVICE,
      toJson(RevokeDeviceRequestSchema, request),
    )
  }

  public async resolveConflict(conflictId: string, winner: "local" | "cloud"): Promise<void> {
    const request = create(ResolveConflictRequestSchema, {
      conflictId,
      winner: winner === "local" ? ConflictWinner.LOCAL : ConflictWinner.CLOUD,
      deviceId: this.tokenStore.getDeviceId() ?? "",
    })
    await this.call(
      SyncService.typeName,
      METHOD_RESOLVE_CONFLICT,
      toJson(ResolveConflictRequestSchema, request),
    )
  }

  public async fetchLoser(conflictId: string): Promise<FetchLoserResponse> {
    const request = create(FetchLoserRequestSchema, { conflictId })
    const json = await this.call(
      SyncService.typeName,
      METHOD_FETCH_LOSER,
      toJson(FetchLoserRequestSchema, request),
    )
    return fromJson(FetchLoserResponseSchema, json, { ignoreUnknownFields: true })
  }

  public async refreshSession(): Promise<void> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight
    }
    const refresh = this.refreshSessionOnce()
    this.refreshInFlight = refresh
    try {
      await refresh
    } finally {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = null
      }
    }
  }

  private async refreshSessionOnce(): Promise<void> {
    const refreshToken = this.tokenStore.loadRefreshToken()
    if (refreshToken === undefined) {
      throw new ErrUnauthorized()
    }
    const tokenEndpoint = `${this.config.zitadelIssuer}/oauth/v2/token`
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.value,
      client_id: this.config.clientId,
    })

    let response: Response
    try {
      response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
    } catch (error) {
      throw new ErrCloudOffline(error)
    }

    if (!response.ok) {
      throw new ErrUnauthorized()
    }

    let tokens: { id_token?: string; refresh_token?: string }
    try {
      tokens = (await response.json()) as { id_token?: string; refresh_token?: string }
    } catch {
      throw new ErrUnauthorized()
    }
    if (!tokens.id_token) {
      throw new ErrUnauthorized()
    }

    // Providers may invalidate the old refresh token as soon as they issue a
    // rotated one. Persist the replacement atomically before session exchange.
    if (tokens.refresh_token) {
      refreshToken.rotate(tokens.refresh_token)
    }
    const sessionToken = await exchangeDesktopSession(this.config.baseUrl, tokens.id_token)
    refreshToken.setAccessToken(sessionToken)
    this.events.onAuthenticated?.()
  }

  private async call(serviceName: string, methodName: string, body: JsonValue): Promise<JsonValue> {
    const sessionBeforeCall = this.tokenStore.getAccessToken()
    try {
      return await this.callOnce(serviceName, methodName, body)
    } catch (error) {
      if (!(error instanceof ErrUnauthorized)) {
        throw error
      }
    }

    // A concurrent RPC may already have refreshed the shared in-memory
    // session. Otherwise perform exactly one refresh for this call.
    if (this.tokenStore.getAccessToken() === sessionBeforeCall) {
      try {
        await this.refreshSession()
      } catch (error) {
        if (error instanceof ErrUnauthorized) {
          this.events.onAuthenticationRequired?.()
        }
        throw error
      }
    }
    try {
      return await this.callOnce(serviceName, methodName, body)
    } catch (error) {
      if (error instanceof ErrUnauthorized) {
        this.events.onAuthenticationRequired?.()
      }
      throw error
    }
  }

  private async callOnce(serviceName: string, methodName: string, body: JsonValue): Promise<JsonValue> {
    const accessToken = this.tokenStore.getAccessToken()
    if (!accessToken) {
      throw new ErrUnauthorized()
    }

    const url = `${this.config.baseUrl}/${serviceName}/${methodName}`
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new ErrCloudOffline(error)
    }

    if (response.status === 401) {
      throw new ErrUnauthorized()
    }

    if (!response.ok) {
      throw new Error(`Connect call failed: ${serviceName}/${methodName} — HTTP ${response.status}`)
    }

    return await response.json() as JsonValue
  }
}
