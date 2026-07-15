/**
 * RFC 8252 desktop linking — opens a system browser to ZITADEL, captures the
 * OAuth callback on a random loopback port, exchanges the code for tokens,
 * registers the device with the Go API, and encrypts the refresh token with
 * the existing per-installation keyfile.
 *
 * Security invariants:
 * - Listener binds 127.0.0.1 ONLY (never 0.0.0.0, never localhost).
 * - Port is OS-assigned (ephemeral), never hardcoded.
 * - PKCE S256 is mandatory (plain method rejected by ZITADEL).
 * - State is validated against the in-memory value generated for the flow.
 * - Refresh token is encrypted with the existing keyfile (no new key material).
 * - Listener accepts exactly ONE successful callback, then closes.
 * - Timeout: 5 minutes.
 */

import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomBytes, createHash } from "node:crypto"
import { shell } from "electron"
import { readKeyfile } from "../../core/secrets/keyfile"
import { encrypt, generateDek, wrapDek, type EncryptedBlob } from "../../core/secrets/crypto"
import { create, fromJson, toJsonString } from "@bufbuild/protobuf"
import {
  DeviceSchema,
  DeviceService,
  RegisterDeviceRequestSchema,
  SyncWorkspaceListSchema,
  type Device,
  type RegisterDeviceRequest,
  type SyncWorkspace,
} from "@apiweave/proto/apiweave/v1/device_pb"
import { exchangeDesktopSession } from "./cloud-client"

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ErrLinkTimeout extends Error {
  constructor() {
    super("Device link timed out after 5 minutes")
    this.name = "ErrLinkTimeout"
  }
}

export class ErrLinkStateMismatch extends Error {
  constructor() {
    super("OAuth state mismatch — possible CSRF attack")
    this.name = "ErrLinkStateMismatch"
  }
}

export class ErrLinkBadCallback extends Error {
  constructor(reason: string) {
    super(`Bad OAuth callback: ${reason}`)
    this.name = "ErrLinkBadCallback"
  }
}

export class ErrLinkExchangeFailed extends Error {
  constructor(reason: string) {
    super(`Token exchange failed: ${reason}`)
    this.name = "ErrLinkExchangeFailed"
  }
}

export class ErrLinkStoreFailed extends Error {
  constructor(reason: string) {
    super(`Credential storage failed: ${reason}`)
    this.name = "ErrLinkStoreFailed"
  }
}

export class ErrLinkCancelled extends Error {
  constructor() {
    super("Device link was cancelled")
    this.name = "ErrLinkCancelled"
  }
}

export class ErrLinkBusy extends Error {
  constructor() {
    super("A device link is already in progress")
    this.name = "ErrLinkBusy"
  }
}

export class ErrLinkListenerFailed extends Error {
  constructor() {
    super("Could not start the secure local authentication callback")
    this.name = "ErrLinkListenerFailed"
  }
}

export class ErrLinkBrowserFailed extends Error {
  constructor() {
    super("Could not open the system browser for authentication")
    this.name = "ErrLinkBrowserFailed"
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceRecord {
  readonly deviceId: string
  readonly publicKey: Uint8Array
  readonly label: string
  readonly clientVersion: string
  readonly createdAt: string
}

export interface DeviceLinkResult {
  readonly device: DeviceRecord
  readonly workspaces: readonly SyncWorkspace[]
  readonly encryptedRefreshToken: EncryptedBlob
  readonly wrappedDek: Uint8Array
  readonly accessToken: string
}

export interface DeviceLinkConfig {
  readonly zitadelIssuer: string
  readonly desktopClientId: string
  readonly apiBaseUrl: string
  readonly keyfilePath: string
  readonly deviceLabel: string
  readonly devicePublicKey: Uint8Array
  readonly clientVersion: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

interface TokenResponse {
  access_token: string
  id_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOOPBACK_HOST = "127.0.0.1"
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const CALLBACK_PATH = "/callback"
const METHOD_REGISTER_DEVICE = "RegisterDevice"
const METHOD_LIST_SYNC_WORKSPACES = "ListSyncWorkspaces"

// ─── Implementation ──────────────────────────────────────────────────────────

interface ActiveLink {
  readonly controller: AbortController
  listener: http.Server | null
}

let activeLink: ActiveLink | null = null

/**
 * Start the device link flow. Opens a system browser to the ZITADEL authorize
 * URL, spawns a transient HTTP listener on a random loopback port, waits for
 * the OAuth callback, exchanges the code for tokens, registers the device,
 * and encrypts the refresh token.
 *
 * Returns the device record and encrypted credentials.
 */
export async function startDeviceLink(config: DeviceLinkConfig): Promise<DeviceLinkResult> {
  if (activeLink !== null) {
    throw new ErrLinkBusy()
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const link: ActiveLink = { controller, listener: null }
  activeLink = link
  const abortFromCaller = (): void => controller.abort(config.signal?.reason ?? new ErrLinkCancelled())
  if (config.signal?.aborted === true) {
    abortFromCaller()
  } else {
    config.signal?.addEventListener("abort", abortFromCaller, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(new ErrLinkTimeout()), timeoutMs)

  try {
    controller.signal.throwIfAborted()
    // Generate PKCE verifier and challenge (S256).
    const codeVerifier = randomBytes(32).toString("base64url")
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")

    // Generate state for CSRF protection.
    const state = randomBytes(16).toString("hex")

    // Spawn transient HTTP listener on random loopback port.
    let listener: { server: http.Server; port: number }
    try {
      listener = await spawnListener(controller.signal)
    } catch {
      rethrowAbort(controller.signal)
      throw new ErrLinkListenerFailed()
    }
    const { server, port } = listener
    link.listener = server

    // Build authorize URL.
    const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`
    const authorizeUrl = buildAuthorizeUrl(config, redirectUri, codeChallenge, state)

    // Open system browser.
    try {
      await shell.openExternal(authorizeUrl)
    } catch {
      throw new ErrLinkBrowserFailed()
    }

    // Wait for callback with timeout.
    const callbackResult = await waitForCallback(server, state, controller.signal)

    // Exchange code for tokens at ZITADEL.
    const tokens = await exchangeCode(config, callbackResult.code, redirectUri, codeVerifier, controller.signal)

    // Verify id_token (using jose for local verification).
    await verifyIdToken(config, tokens.id_token, controller.signal)

    // Exchange the provider token once; DeviceService and SyncService accept
    // only the resulting opaque APIWeave session.
    let sessionToken: string
    try {
      sessionToken = await exchangeDesktopSession(config.apiBaseUrl, tokens.id_token, controller.signal)
    } catch (err) {
      rethrowAbort(controller.signal)
      throw new ErrLinkExchangeFailed(`Session exchange failed: ${(err as Error).message}`)
    }

    const device = await registerDevice(config, sessionToken, controller.signal)
    const workspaces = await listSyncWorkspaces(config, sessionToken, controller.signal)

    // Encrypt refresh token with existing keyfile.
    const { blob, wrappedDek } = encryptRefreshToken(config, tokens.refresh_token)

    return {
      device,
      workspaces,
      encryptedRefreshToken: blob,
      wrappedDek,
      accessToken: sessionToken,
    }
  } finally {
    clearTimeout(timeout)
    config.signal?.removeEventListener("abort", abortFromCaller)
    // Always close the listener.
    if (link.listener !== null) {
      await closeListener(link.listener)
    }
    if (activeLink === link) {
      activeLink = null
    }
  }
}

/**
 * Cancel an in-progress device link. Closes the listener without resolving.
 */
export function cancelDeviceLink(): void {
  if (activeLink !== null) {
    activeLink.controller.abort(new ErrLinkCancelled())
    if (activeLink.listener !== null) {
      void closeListener(activeLink.listener)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawnListener(signal: AbortSignal): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    const onAbort = (): void => {
      void closeListener(server)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    server.listen(0, LOOPBACK_HOST, () => {
      signal.removeEventListener("abort", onAbort)
      const address = server.address() as AddressInfo | null
      if (!address) {
        server.close()
        reject(new Error("Failed to bind listener"))
        return
      }
      resolve({ server, port: address.port })
    })
    server.once("error", (error) => {
      signal.removeEventListener("abort", onAbort)
      reject(error)
    })
  })
}

function closeListener(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

function buildAuthorizeUrl(
  config: DeviceLinkConfig,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.desktopClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email offline_access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })
  return `${config.zitadelIssuer}/oauth/v2/authorize?${params.toString()}`
}

interface CallbackResult {
  code: string
  state: string
}

function waitForCallback(
  server: http.Server,
  expectedState: string,
  signal: AbortSignal,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (action: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener("abort", onAbort)
      action()
    }
    const onAbort = (): void => settle(() => reject(signal.reason))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }

    server.on("request", (req, res) => {
      if (settled) {
        res.writeHead(410).end("Already processed")
        return
      }

      const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`)
      if (url.pathname !== CALLBACK_PATH || req.method !== "GET") {
        res.writeHead(404).end("Not found")
        return
      }

      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>",
        )
        settle(() => reject(new ErrLinkBadCallback(error)))
        return
      }

      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>Invalid callback</h1><p>You can close this window.</p></body></html>",
        )
        settle(() => reject(new ErrLinkBadCallback("missing code or state")))
        return
      }

      if (state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>State mismatch</h1><p>You can close this window.</p></body></html>",
        )
        settle(() => reject(new ErrLinkStateMismatch()))
        return
      }

      // Success.
      res.writeHead(200, { "content-type": "text/html" }).end(
        "<html><body><h1>Success!</h1><p>You can close this window and return to the app.</p></body></html>",
      )
      settle(() => resolve({ code, state }))
    })
  })
}

async function exchangeCode(
  config: DeviceLinkConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  signal: AbortSignal,
): Promise<TokenResponse> {
  const tokenEndpoint = `${config.zitadelIssuer}/oauth/v2/token`

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: config.desktopClientId,
  })

  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
    })
  } catch {
    rethrowAbort(signal)
    throw new ErrLinkExchangeFailed("Token endpoint unavailable")
  }

  if (!response.ok) {
    throw new ErrLinkExchangeFailed(`HTTP ${response.status}`)
  }

  let tokens: TokenResponse
  try {
    tokens = (await response.json()) as TokenResponse
  } catch {
    throw new ErrLinkExchangeFailed("invalid token response")
  }
  if (!tokens.access_token || !tokens.id_token || !tokens.refresh_token) {
    throw new ErrLinkExchangeFailed("missing tokens in response")
  }

  return tokens
}

async function verifyIdToken(config: DeviceLinkConfig, idToken: string, signal: AbortSignal): Promise<void> {
  // ponytail: local verification with jose. The Go API's auth middleware validates
  // bearer tokens on every request, so this is a belt-and-suspenders check.
  // If a Go API /auth/verify endpoint is added later, prefer that to keep crypto
  // in one place.
  const { createLocalJWKSet, jwtVerify } = await import("jose")

  const jwksUri = `${config.zitadelIssuer}/oauth/v2/keys`

  try {
    const response = await fetch(jwksUri, { headers: { accept: "application/json" }, signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const jwks = await response.json() as Parameters<typeof createLocalJWKSet>[0]
    const JWKS = createLocalJWKSet(jwks)
    await jwtVerify(idToken, JWKS, {
      issuer: config.zitadelIssuer,
      audience: config.desktopClientId,
    })
  } catch (err) {
    rethrowAbort(signal)
    throw new ErrLinkExchangeFailed("id_token verification failed")
  }
}

async function registerDevice(
  config: DeviceLinkConfig,
  accessToken: string,
  signal: AbortSignal,
): Promise<DeviceRecord> {
  const endpoint = `${config.apiBaseUrl}/${DeviceService.typeName}/${METHOD_REGISTER_DEVICE}`
  const request: RegisterDeviceRequest = create(RegisterDeviceRequestSchema, {
    publicKey: config.devicePublicKey,
    label: config.deviceLabel,
    clientVersion: config.clientVersion,
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: toJsonString(RegisterDeviceRequestSchema, request),
      signal,
    })
  } catch {
    rethrowAbort(signal)
    throw new ErrLinkExchangeFailed("Device registration unavailable")
  }

  if (!response.ok) {
    throw new ErrLinkExchangeFailed(`Device registration failed: HTTP ${response.status}`)
  }

  let device: Device
  try {
    device = await parseDeviceResponse(response)
  } catch {
    throw new ErrLinkExchangeFailed("Invalid device registration response")
  }

  return {
    deviceId: device.id,
    publicKey: device.publicKey,
    label: device.label,
    clientVersion: device.clientVersion,
    createdAt: timestampToIso(device.createdAt),
  }
}

async function parseDeviceResponse(response: Response): Promise<Device> {
  return fromJson(DeviceSchema, await response.json())
}

async function listSyncWorkspaces(
  config: DeviceLinkConfig,
  accessToken: string,
  signal: AbortSignal,
): Promise<readonly SyncWorkspace[]> {
  const endpoint = `${config.apiBaseUrl}/${DeviceService.typeName}/${METHOD_LIST_SYNC_WORKSPACES}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
      signal,
    })
  } catch {
    rethrowAbort(signal)
    throw new ErrLinkExchangeFailed("Workspace catalog unavailable")
  }
  if (!response.ok) {
    throw new ErrLinkExchangeFailed(`Workspace catalog failed: HTTP ${response.status}`)
  }
  try {
    return fromJson(SyncWorkspaceListSchema, await response.json()).workspaces
  } catch {
    throw new ErrLinkExchangeFailed("Invalid workspace catalog response")
  }
}

function timestampToIso(value: Device["createdAt"] | string): string {
  if (value === undefined) {
    return new Date().toISOString()
  }
  if (typeof value === "string") {
    return value
  }
  const seconds = Number(value.seconds)
  const nanos = value.nanos
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString()
}

function encryptRefreshToken(
  config: DeviceLinkConfig,
  refreshToken: string,
): { blob: EncryptedBlob; wrappedDek: Uint8Array } {
  try {
    const keyfile = readKeyfile(config.keyfilePath)
    const dek = generateDek()
    const wrappedDek = wrapDek(dek, keyfile.masterKek)
    const blob = encrypt(refreshToken, dek, "kek-desktop-link")
    return { blob, wrappedDek }
  } catch (err) {
    throw new ErrLinkStoreFailed(`Failed to encrypt refresh token: ${(err as Error).message}`)
  }
}

function rethrowAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason
  }
}
