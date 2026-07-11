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
import { createServer } from "node:net"
import { randomBytes, createHash } from "node:crypto"
import { shell } from "electron"
import { readKeyfile, type Keyfile } from "../../core/secrets/keyfile"
import { encrypt, generateDek, wrapDek, type EncryptedBlob } from "../../core/secrets/crypto"

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
  readonly encryptedRefreshToken: EncryptedBlob
  readonly wrappedDek: Uint8Array
  readonly accessToken: string
  readonly idToken: string
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

// ─── Implementation ──────────────────────────────────────────────────────────

let activeListener: http.Server | null = null

/**
 * Start the device link flow. Opens a system browser to the ZITADEL authorize
 * URL, spawns a transient HTTP listener on a random loopback port, waits for
 * the OAuth callback, exchanges the code for tokens, registers the device,
 * and encrypts the refresh token.
 *
 * Returns the device record and encrypted credentials.
 */
export async function startDeviceLink(config: DeviceLinkConfig): Promise<DeviceLinkResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Generate PKCE verifier and challenge (S256).
  const codeVerifier = randomBytes(32).toString("base64url")
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")

  // Generate state for CSRF protection.
  const state = randomBytes(16).toString("hex")

  // Spawn transient HTTP listener on random loopback port.
  const { server, port } = await spawnListener()
  activeListener = server

  try {
    // Build authorize URL.
    const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`
    const authorizeUrl = buildAuthorizeUrl(config, redirectUri, codeChallenge, state)

    // Open system browser.
    await shell.openExternal(authorizeUrl)

    // Wait for callback with timeout.
    const callbackResult = await waitForCallback(server, state, timeoutMs)

    // Exchange code for tokens at ZITADEL.
    const tokens = await exchangeCode(config, callbackResult.code, redirectUri, codeVerifier)

    // Verify id_token (using jose for local verification).
    await verifyIdToken(config, tokens.id_token)

    // Register device with Go API.
    const device = await registerDevice(config, tokens.access_token)

    // Encrypt refresh token with existing keyfile.
    const { blob, wrappedDek } = encryptRefreshToken(config, tokens.refresh_token)

    return {
      device,
      encryptedRefreshToken: blob,
      wrappedDek,
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
    }
  } finally {
    // Always close the listener.
    await closeListener(server)
    activeListener = null
  }
}

/**
 * Cancel an in-progress device link. Closes the listener without resolving.
 */
export function cancelDeviceLink(): void {
  if (activeListener) {
    void closeListener(activeListener)
    activeListener = null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function spawnListener(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address() as AddressInfo | null
      if (!address) {
        server.close()
        reject(new Error("Failed to bind listener"))
        return
      }
      resolve({ server, port: address.port })
    })
    server.once("error", reject)
  })
}

function closeListener(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
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
    scope: "openid profile email",
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
  timeoutMs: number,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new ErrLinkTimeout())
      }
    }, timeoutMs)

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
        settled = true
        clearTimeout(timeout)
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>",
        )
        reject(new ErrLinkBadCallback(error))
        return
      }

      if (!code || !state) {
        settled = true
        clearTimeout(timeout)
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>Invalid callback</h1><p>You can close this window.</p></body></html>",
        )
        reject(new ErrLinkBadCallback("missing code or state"))
        return
      }

      if (state !== expectedState) {
        settled = true
        clearTimeout(timeout)
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h1>State mismatch</h1><p>You can close this window.</p></body></html>",
        )
        reject(new ErrLinkStateMismatch())
        return
      }

      // Success.
      settled = true
      clearTimeout(timeout)
      res.writeHead(200, { "content-type": "text/html" }).end(
        "<html><body><h1>Success!</h1><p>You can close this window and return to the app.</p></body></html>",
      )
      resolve({ code, state })
    })
  })
}

async function exchangeCode(
  config: DeviceLinkConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const tokenEndpoint = `${config.zitadelIssuer}/oauth/v2/token`

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: config.desktopClientId,
  })

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ErrLinkExchangeFailed(`HTTP ${response.status}: ${text}`)
  }

  const tokens = (await response.json()) as TokenResponse
  if (!tokens.access_token || !tokens.id_token || !tokens.refresh_token) {
    throw new ErrLinkExchangeFailed("missing tokens in response")
  }

  return tokens
}

async function verifyIdToken(config: DeviceLinkConfig, idToken: string): Promise<void> {
  // ponytail: local verification with jose. The Go API's auth middleware validates
  // bearer tokens on every request, so this is a belt-and-suspenders check.
  // If a Go API /auth/verify endpoint is added later, prefer that to keep crypto
  // in one place.
  const { createRemoteJWKSet, jwtVerify } = await import("jose")

  const jwksUri = `${config.zitadelIssuer}/oauth/v2/keys`
  const JWKS = createRemoteJWKSet(new URL(jwksUri))

  try {
    await jwtVerify(idToken, JWKS, {
      issuer: config.zitadelIssuer,
      audience: config.desktopClientId,
    })
  } catch (err) {
    throw new ErrLinkExchangeFailed(`id_token verification failed: ${(err as Error).message}`)
  }
}

async function registerDevice(
  config: DeviceLinkConfig,
  accessToken: string,
): Promise<DeviceRecord> {
  const endpoint = `${config.apiBaseUrl}/apiweave.v1.DeviceService/RegisterDevice`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      publicKey: Buffer.from(config.devicePublicKey).toString("base64"),
      label: config.deviceLabel,
      clientVersion: config.clientVersion,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ErrLinkExchangeFailed(`Device registration failed: HTTP ${response.status}: ${text}`)
  }

  const device = (await response.json()) as {
    id: string
    publicKey: string
    label: string
    clientVersion: string
    createdAt: string
  }

  return {
    deviceId: device.id,
    publicKey: Buffer.from(device.publicKey, "base64"),
    label: device.label,
    clientVersion: device.clientVersion,
    createdAt: device.createdAt,
  }
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
