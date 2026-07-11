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

import type { KVStore } from "../../core/db"
import { readKeyfile } from "../../core/secrets/keyfile"
import { encrypt, decrypt, generateDek, wrapDek, unwrapDek, type EncryptedBlob } from "../../core/secrets/crypto"

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
  public constructor(
    private readonly store: KVStore,
    private readonly keyfilePath: string,
  ) {}

  public hasTokens(): boolean {
    const row = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_DEVICE_ID],
    )
    return row !== undefined
  }

  public getDeviceId(): string | undefined {
    const row = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_DEVICE_ID],
    )
    return row?.value
  }

  public getAccessToken(): string | undefined {
    const row = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_ACCESS_TOKEN],
    )
    return row?.value
  }

  public getRefreshToken(): string | undefined {
    const encRow = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_ENCRYPTED_REFRESH],
    )
    const dekRow = this.store.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [KEY_WRAPPED_DEK],
    )
    if (!encRow || !dekRow) {
      return undefined
    }

    const keyfile = readKeyfile(this.keyfilePath)
    const wrappedDek = Buffer.from(dekRow.value, "base64")
    const dek = unwrapDek(new Uint8Array(wrappedDek), keyfile.masterKek)

    const blobJson = JSON.parse(encRow.value) as {
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
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_DEVICE_ID, deviceId],
    )
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_ACCESS_TOKEN, accessToken],
    )

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
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_ENCRYPTED_REFRESH, JSON.stringify(blobJson)],
    )
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_WRAPPED_DEK, Buffer.from(wrappedDek).toString("base64")],
    )
  }

  public setAccessToken(accessToken: string): void {
    this.store.set(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [KEY_ACCESS_TOKEN, accessToken],
    )
  }

  public clearTokens(): void {
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_DEVICE_ID])
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_ACCESS_TOKEN])
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_ENCRYPTED_REFRESH])
    this.store.delete("DELETE FROM app_settings WHERE key = ?", [KEY_WRAPPED_DEK])
  }
}

// ─── Cloud Client ────────────────────────────────────────────────────────────

export interface CloudClientConfig {
  readonly baseUrl: string
  readonly clientVersion: string
}

export interface HelloResponse {
  readonly protocolVersion: number
  readonly serverNow?: string
  readonly fullResyncRequired: boolean
}

export interface ChangeEnvelope {
  readonly cursor: bigint
  readonly workspaceId: string
  readonly kind: number
  readonly recordId: string
  readonly rev: bigint
  readonly op: number
  readonly payload: Uint8Array
  readonly deletedAt?: string
}

export interface PullChangesResponse {
  readonly changes: ChangeEnvelope[]
  readonly nextCursor: bigint
  readonly hasMore: boolean
  readonly serverNow?: string
}

export interface PushOutcome {
  readonly deltaIndex: number
  readonly status: number
  readonly newRev: bigint
  readonly rejectionReason: number
  readonly conflictId: string
}

export interface PushDeltasResponse {
  readonly outcomes: PushOutcome[]
}

export interface PushDelta {
  readonly workspaceId: string
  readonly kind: number
  readonly recordId: string
  readonly expectedRev: bigint
  readonly payload: Uint8Array
  readonly op: number
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

export class CloudClient {
  public constructor(
    private readonly config: CloudClientConfig,
    private readonly tokenStore: DeviceTokenStore,
  ) {}

  public async hello(): Promise<HelloResponse> {
    const response = await this.call<HelloResponse>("SyncService/Hello", {
      clientVersion: this.config.clientVersion,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    })

    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(response.protocolVersion)) {
      throw new ErrProtocolMismatch(response.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS)
    }

    return response
  }

  public async pullChanges(workspaceId: string, cursor: bigint, pageSize: number): Promise<PullChangesResponse> {
    return this.call<PullChangesResponse>("SyncService/PullChanges", {
      deviceId: this.tokenStore.getDeviceId() ?? "",
      cursor: cursor.toString(),
      pageSize,
      workspaceId: { value: workspaceId },
    })
  }

  public async pushDeltas(idempotencyKey: string, deltas: PushDelta[]): Promise<PushDeltasResponse> {
    return this.call<PushDeltasResponse>("SyncService/PushDeltas", {
      deviceId: this.tokenStore.getDeviceId() ?? "",
      idempotencyKey,
      deltas: deltas.map((d) => ({
        workspaceId: { value: d.workspaceId },
        kind: d.kind,
        recordId: d.recordId,
        expectedRev: d.expectedRev.toString(),
        payload: Buffer.from(d.payload).toString("base64"),
        op: d.op,
      })),
    })
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

  private async call<T>(method: string, body: unknown): Promise<T> {
    const accessToken = this.tokenStore.getAccessToken()
    if (!accessToken) {
      throw new ErrUnauthorized()
    }

    const url = `${this.config.baseUrl}/apiweave.v1.${method}`
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
      throw new Error(`Connect call failed: ${method} — HTTP ${response.status}: ${text}`)
    }

    const json = await response.json() as Record<string, unknown>
    return this.parseResponse<T>(json)
  }

  private parseResponse<T>(json: Record<string, unknown>): T {
    if (json["changes"] && Array.isArray(json["changes"])) {
      for (const change of json["changes"] as Record<string, unknown>[]) {
        if (typeof change["payload"] === "string") {
          change["payload"] = new Uint8Array(Buffer.from(change["payload"] as string, "base64"))
        }
      }
    }
    return json as T
  }
}
