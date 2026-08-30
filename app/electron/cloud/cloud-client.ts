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
  CreateSyncWorkspaceRequestSchema,
  DeviceService,
  EnsureSyncWorkspaceRequestSchema,
  GetWorkspaceEncryptionRequestSchema,
  RevokeDeviceRequestSchema,
  SetWorkspacePassphraseRequestSchema,
  SyncTeamListSchema,
  SyncWorkspaceListSchema,
  SyncWorkspaceSchema,
  WorkspaceEncryptionSchema,
  type SyncTeamList,
  type SyncWorkspace,
} from "@apiweave/proto/apiweave/v1/device_pb"
import {
  toEncryptionMessage,
  toEncryptionRecord,
  type WorkspaceEncryptionBundle,
  type WorkspaceEncryptionRecord,
} from "./workspace-encryption"
import {
  CreateTeamRequestSchema,
  TeamSchema,
  TeamService,
  type Team,
} from "@apiweave/proto/apiweave/v1/team_pb"
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
  MergeSide,
  ResolveConflictRequestSchema,
  ResolveConflictResponseSchema,
  SyncService,
  type ChangeEnvelope,
  type ResolveConflictResponse,
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

/** A non-2xx Connect response (other than 401). Carries the HTTP status so
 * callers can react to a specific code — e.g. 409 (Aborted). */
export class ErrCloudRequestFailed extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "ErrCloudRequestFailed"
  }
}

/** The conflict snapshot being resolved is stale: the cloud record advanced
 * past it, so the server refused "keep local" (Aborted/409) rather than clobber
 * unseen cloud changes. Recoverable — the local resolution re-enqueues the edit
 * and the next push reconciles against the current cloud rev. */
export class ErrCloudConflictStale extends Error {
  constructor() {
    super("conflict snapshot is stale — the cloud copy changed")
    this.name = "ErrCloudConflictStale"
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
const METHOD_LIST_SYNC_TEAMS = "ListSyncTeams"
const METHOD_ENSURE_SYNC_WORKSPACE = "EnsureSyncWorkspace"
const METHOD_CREATE_SYNC_WORKSPACE = "CreateSyncWorkspace"
const METHOD_GET_WORKSPACE_ENCRYPTION = "GetWorkspaceEncryption"
const METHOD_SET_WORKSPACE_PASSPHRASE = "SetWorkspacePassphrase"
const METHOD_CREATE_TEAM = "CreateTeam"
const METHOD_REVOKE_DEVICE = "RevokeDevice"
const METHOD_RESOLVE_CONFLICT = "ResolveConflict"

// Maps a winner string to the proto enum. MERGED requests a server-computed
// 3-way auto-merge (only valid when the conflict is cleanly auto-mergeable).
function conflictWinnerEnum(winner: "local" | "cloud" | "merged"): ConflictWinner {
  switch (winner) {
    case "local":
      return ConflictWinner.LOCAL
    case "cloud":
      return ConflictWinner.CLOUD
    case "merged":
      return ConflictWinner.MERGED
  }
}
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

  public async listSyncWorkspaces(): Promise<readonly SyncWorkspace[]> {
    const json = await this.call(
      DeviceService.typeName,
      METHOD_LIST_SYNC_WORKSPACES,
      toJson(EmptySchema, create(EmptySchema)),
    )
    return fromJson(SyncWorkspaceListSchema, json, { ignoreUnknownFields: true }).workspaces
  }

  public async listSyncTeams(): Promise<SyncTeamList> {
    const json = await this.call(
      DeviceService.typeName,
      METHOD_LIST_SYNC_TEAMS,
      toJson(EmptySchema, create(EmptySchema)),
    )
    return fromJson(SyncTeamListSchema, json, { ignoreUnknownFields: true })
  }

  /**
   * `encryption` is applied ONLY to a workspace this call creates. On a
   * workspace that already exists the server silently ignores it and reports
   * the stored mode, which is why the caller must read `encryptionMode` off the
   * returned entry and never assume the bundle took.
   */
  public async ensureSyncWorkspace(params: {
    workspaceId: string
    name: string
    slug: string
    isPersonal: boolean
    encryption?: WorkspaceEncryptionBundle
  }): Promise<SyncWorkspace> {
    const request = create(EnsureSyncWorkspaceRequestSchema, {
      workspaceId: params.workspaceId,
      name: params.name,
      slug: params.slug,
      isPersonal: params.isPersonal,
      ...(params.encryption !== undefined ? { encryption: toEncryptionMessage(params.encryption) } : {}),
    })
    const json = await this.call(
      DeviceService.typeName,
      METHOD_ENSURE_SYNC_WORKSPACE,
      toJson(EnsureSyncWorkspaceRequestSchema, request),
    )
    return fromJson(SyncWorkspaceSchema, json, { ignoreUnknownFields: true })
  }

  /**
   * Every retry of a `requestId` must carry the byte-identical `encryption`
   * bundle or the server fails it `ALREADY_EXISTS`. The request body is built
   * once here and reused by {@link call}'s post-refresh retry, so the caller
   * only has to avoid re-deriving a bundle for a repeat of the same requestId.
   */
  public async createSyncWorkspace(params: {
    requestId: string
    teamId: string
    name: string
    slug: string
    encryption?: WorkspaceEncryptionBundle
  }): Promise<SyncWorkspace> {
    const { encryption, ...fields } = params
    const request = create(CreateSyncWorkspaceRequestSchema, {
      ...fields,
      ...(encryption !== undefined ? { encryption: toEncryptionMessage(encryption) } : {}),
    })
    const json = await this.call(
      DeviceService.typeName,
      METHOD_CREATE_SYNC_WORKSPACE,
      toJson(CreateSyncWorkspaceRequestSchema, request),
    )
    return fromJson(SyncWorkspaceSchema, json, { ignoreUnknownFields: true })
  }

  /** Any member may read a workspace's encryption record. Plaintext → `mode: "none"`. */
  public async getWorkspaceEncryption(cloudWorkspaceId: string): Promise<WorkspaceEncryptionRecord> {
    const json = await this.call(
      DeviceService.typeName,
      METHOD_GET_WORKSPACE_ENCRYPTION,
      toJson(GetWorkspaceEncryptionRequestSchema, create(GetWorkspaceEncryptionRequestSchema, {
        workspaceId: cloudWorkspaceId,
      })),
    )
    return toEncryptionRecord(fromJson(WorkspaceEncryptionSchema, json, { ignoreUnknownFields: true }))
  }

  /** Admin only, and the bundle's fingerprint must match the stored one (same WDEK, new passphrase). */
  public async setWorkspacePassphrase(
    cloudWorkspaceId: string,
    bundle: WorkspaceEncryptionBundle,
  ): Promise<WorkspaceEncryptionRecord> {
    const encryption = toEncryptionMessage(bundle)
    const json = await this.call(
      DeviceService.typeName,
      METHOD_SET_WORKSPACE_PASSPHRASE,
      toJson(SetWorkspacePassphraseRequestSchema, create(SetWorkspacePassphraseRequestSchema, {
        workspaceId: cloudWorkspaceId,
        wrappedWdek: encryption.wrappedWdek,
        kdfSalt: encryption.kdfSalt,
        kdfParams: encryption.kdfParams,
        wdekFingerprint: encryption.wdekFingerprint,
      })),
    )
    return toEncryptionRecord(fromJson(WorkspaceEncryptionSchema, json, { ignoreUnknownFields: true }))
  }

  public async createTeam(name: string, slug: string): Promise<Team> {
    const request = create(CreateTeamRequestSchema, { name, slug })
    const json = await this.call(
      TeamService.typeName,
      METHOD_CREATE_TEAM,
      toJson(CreateTeamRequestSchema, request),
    )
    return fromJson(TeamSchema, json, { ignoreUnknownFields: true })
  }

  public async revokeDevice(deviceId: string): Promise<void> {
    const request = create(RevokeDeviceRequestSchema, { deviceId })
    await this.call(
      DeviceService.typeName,
      METHOD_REVOKE_DEVICE,
      toJson(RevokeDeviceRequestSchema, request),
    )
  }

  public async resolveConflict(
    conflictId: string,
    winner: "local" | "cloud" | "merged",
    resolutions: readonly { readonly path: string; readonly side: "local" | "cloud" }[] = [],
  ): Promise<ResolveConflictResponse> {
    const request = create(ResolveConflictRequestSchema, {
      conflictId,
      winner: conflictWinnerEnum(winner),
      deviceId: this.tokenStore.getDeviceId() ?? "",
      resolutions: resolutions.map((r) => ({
        path: r.path,
        side: r.side === "local" ? MergeSide.LOCAL : MergeSide.CLOUD,
      })),
    })
    try {
      const json = await this.call(
        SyncService.typeName,
        METHOD_RESOLVE_CONFLICT,
        toJson(ResolveConflictRequestSchema, request),
      )
      return fromJson(ResolveConflictResponseSchema, json, { ignoreUnknownFields: true })
    } catch (error) {
      // Aborted (HTTP 409) here means "keep local" hit the server's rev guard:
      // the record moved past the snapshot's cloud_rev. Surface it as a stale
      // conflict so the caller can recover instead of showing a raw transport
      // error.
      if (error instanceof ErrCloudRequestFailed && error.status === 409) {
        throw new ErrCloudConflictStale()
      }
      throw error
    }
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
      throw new ErrCloudRequestFailed(
        response.status,
        `Connect call failed: ${serviceName}/${methodName} — HTTP ${response.status}`,
      )
    }

    return await response.json() as JsonValue
  }
}
