/**
 * Cloud client and device token store.
 *
 * DeviceTokenStore: manages encrypted tokens using the existing keyfile
 * infrastructure. Stores the encrypted refresh token, wrapped DEK, access
 * token, and device ID in the app_settings table.
 *
 * CloudClient: lightweight Connect protocol client for SyncService. Uses
 * fetch() to call the Connect endpoints. No external dependencies.
 */

import { readKeyfile } from "../../core/secrets/keyfile"
import { encrypt, decrypt, generateDek, wrapDek, unwrapDek, type EncryptedBlob } from "../../core/secrets/crypto"
import type { KVStore } from "../../core/db"
import { CloudSyncRepository } from "../../core/repositories"
import { create } from "@bufbuild/protobuf"
import { UlidSchema } from "../../../../apiweave-cloud/apps/web/gen/proto/ts/apiweave/v1/common_pb.js"
import {
  HelloRequestSchema,
  PullChangesRequestSchema,
  PushDeltaSchema,
  PushDeltasRequestSchema,
  SyncService,
  type ChangeEnvelope,
  type HelloRequest,
  type HelloResponse,
  type PullChangesRequest,
  type PullChangesResponse,
  type PushDelta,
  type PushDeltasRequest,
  type PushDeltasResponse,
} from "../../../../apiweave-cloud/apps/web/gen/proto/ts/apiweave/v1/sync_service_pb.js"

// ─── Device Token Store ──────────────────────────────────────────────────────

const KEY_DEVICE_ID = "cloud.device_id"
const KEY_ENCRYPTED_REFRESH = "cloud.encrypted_refresh"
const KEY_WRAPPED_DEK = "cloud.wrapped_dek"
const KEY_ACCESS_TOKEN = "cloud.access_token"

export interface DeviceTokens {
  readonly deviceId: string
  readonly accessToken: string
  readonly refreshToken: string
}

export class DeviceTokenStore {
  private readonly repository: CloudSyncRepository

  public constructor(
    store: KVStore | CloudSyncRepository,
    private readonly keyfilePath: string,
  ) {
    this.repository = store instanceof CloudSyncRepository ? store : new CloudSyncRepository(store)
  }

  public hasTokens(): boolean {
    return this.repository.getSetting(KEY_DEVICE_ID) !== undefined
  }

  public getDeviceId(): string | undefined {
    return this.repository.getSetting(KEY_DEVICE_ID)
  }

  public getAccessToken(): string | undefined {
    return this.repository.getSetting(KEY_ACCESS_TOKEN)
  }

  public getRefreshToken(): string | undefined {
    const encryptedRefresh = this.repository.getSetting(KEY_ENCRYPTED_REFRESH)
    const wrappedDekValue = this.repository.getSetting(KEY_WRAPPED_DEK)
    if (encryptedRefresh === undefined || wrappedDekValue === undefined) {
      return undefined
    }

    const keyfile = readKeyfile(this.keyfilePath)
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
    return decrypt(blob, dek)
  }

  public setTokens(deviceId: string, accessToken: string, refreshToken: string): void {
    this.repository.setSetting(KEY_DEVICE_ID, deviceId)
    this.repository.setSetting(KEY_ACCESS_TOKEN, accessToken)

    const keyfile = readKeyfile(this.keyfilePath)
    const dek = generateDek()
    const wrappedDek = wrapDek(dek, keyfile.masterKek)
    const blob = encrypt(refreshToken, dek, "kek-desktop-link")

    const blobJson = {
      ciphertext: Array.from(blob.ciphertext),
      nonce: Array.from(blob.nonce),
      kekId: blob.kekId,
      algorithm: blob.algorithm,
    }
    this.repository.setSetting(KEY_ENCRYPTED_REFRESH, JSON.stringify(blobJson))
    this.repository.setSetting(KEY_WRAPPED_DEK, Buffer.from(wrappedDek).toString("base64"))
  }

  public setEncryptedTokens(
    deviceId: string,
    accessToken: string,
    encryptedRefreshToken: EncryptedBlob,
    wrappedDek: Uint8Array,
  ): void {
    this.repository.setSetting(KEY_DEVICE_ID, deviceId)
    this.repository.setSetting(KEY_ACCESS_TOKEN, accessToken)
    this.repository.setSetting(KEY_ENCRYPTED_REFRESH, serializeEncryptedBlob(encryptedRefreshToken))
    this.repository.setSetting(KEY_WRAPPED_DEK, Buffer.from(wrappedDek).toString("base64"))
  }

  public setAccessToken(accessToken: string): void {
    this.repository.setSetting(KEY_ACCESS_TOKEN, accessToken)
  }

  public clearTokens(): void {
    this.repository.deleteSetting(KEY_DEVICE_ID)
    this.repository.deleteSetting(KEY_ACCESS_TOKEN)
    this.repository.deleteSetting(KEY_ENCRYPTED_REFRESH)
    this.repository.deleteSetting(KEY_WRAPPED_DEK)
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

// ─── Cloud Client ────────────────────────────────────────────────────────────

export interface CloudClientConfig {
  readonly baseUrl: string
  readonly clientVersion: string
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

export class ErrProtocolMismatch extends Error {
  constructor(
    public readonly serverVersion: number,
    public readonly supportedVersions: number[],
  ) {
    super(`protocol mismatch: server=${serverVersion}, supported=${supportedVersions.join(",")}`)
    this.name = "ErrProtocolMismatch"
  }
}

const SUPPORTED_PROTOCOL_VERSIONS = [1]
const METHOD_HELLO = "Hello"
const METHOD_PULL_CHANGES = "PullChanges"
const METHOD_PUSH_DELTAS = "PushDeltas"

export class CloudClient {
  public constructor(
    private readonly config: CloudClientConfig,
    private readonly tokenStore: DeviceTokenStore,
  ) {}

  public async hello(): Promise<HelloResponse> {
    const request: HelloRequest = create(HelloRequestSchema, {
      clientVersion: this.config.clientVersion,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    })
    const response = await this.call<HelloResponse>(SyncService.typeName, METHOD_HELLO, request)

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
    return this.call<PullChangesResponse>(SyncService.typeName, METHOD_PULL_CHANGES, request)
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
    return this.call<PushDeltasResponse>(SyncService.typeName, METHOD_PUSH_DELTAS, request)
  }

  public async refreshAccessToken(refreshToken: string, zitadelIssuer: string, clientId: string): Promise<string> {
    const tokenEndpoint = `${zitadelIssuer}/oauth/v2/token`
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    })

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new ErrUnauthorized()
    }

    const tokens = (await response.json()) as { access_token: string; refresh_token?: string }
    if (!tokens.access_token) {
      throw new ErrUnauthorized()
    }

    this.tokenStore.setAccessToken(tokens.access_token)
    return tokens.access_token
  }

  private async call<T>(serviceName: string, methodName: string, body: unknown): Promise<T> {
    const accessToken = this.tokenStore.getAccessToken()
    if (!accessToken) {
      throw new ErrUnauthorized()
    }

    const url = `${this.config.baseUrl}/${serviceName}/${methodName}`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body, (_key, value) => {
        if (typeof value === "bigint") {
          return value.toString()
        }
        if (value instanceof Uint8Array) {
          return Buffer.from(value).toString("base64")
        }
        return value
      }),
    })

    if (response.status === 401) {
      throw new ErrUnauthorized()
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Connect call failed: ${serviceName}/${methodName} — HTTP ${response.status}: ${text}`)
    }

    const json = await response.json() as Record<string, unknown>
    return this.parseResponse<T>(json)
  }

  private parseResponse<T>(json: Record<string, unknown>): T {
    if (json["changes"] && Array.isArray(json["changes"])) {
      for (const change of json["changes"] as Record<string, unknown>[]) {
        if (typeof change["cursor"] === "string") {
          change["cursor"] = BigInt(change["cursor"])
        }
        if (typeof change["rev"] === "string") {
          change["rev"] = BigInt(change["rev"])
        }
        if (typeof change["payload"] === "string") {
          change["payload"] = new Uint8Array(Buffer.from(change["payload"] as string, "base64"))
        }
      }
    }
    if (typeof json["nextCursor"] === "string") {
      json["nextCursor"] = BigInt(json["nextCursor"])
    }
    if (json["outcomes"] && Array.isArray(json["outcomes"])) {
      for (const outcome of json["outcomes"] as Record<string, unknown>[]) {
        if (typeof outcome["newRev"] === "string") {
          outcome["newRev"] = BigInt(outcome["newRev"])
        }
        if (typeof outcome["loserPayload"] === "string") {
          outcome["loserPayload"] = new Uint8Array(Buffer.from(outcome["loserPayload"] as string, "base64"))
        }
        if (typeof outcome["winnerPayload"] === "string") {
          outcome["winnerPayload"] = new Uint8Array(Buffer.from(outcome["winnerPayload"] as string, "base64"))
        }
      }
    }
    return json as T
  }
}
