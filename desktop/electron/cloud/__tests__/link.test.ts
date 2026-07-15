import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  startDeviceLink,
  cancelDeviceLink,
  ErrLinkTimeout,
  ErrLinkStateMismatch,
  ErrLinkBadCallback,
  ErrLinkBusy,
  ErrLinkCancelled,
  ErrLinkExchangeFailed,
  type DeviceLinkConfig,
} from "../cloud-link"
import { createKeyfile } from "../../../core/secrets/keyfile"
import { decrypt, unwrapDek } from "../../../core/secrets/crypto"

// Mock electron.shell.openExternal - must be defined before vi.mock
const mockOpenExternal = vi.fn()
vi.mock("electron", () => ({
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}))

// Mock jose for id_token verification
vi.mock("jose", () => ({
  createLocalJWKSet: vi.fn(() => ({})),
  jwtVerify: vi.fn(() => Promise.resolve({ payload: {} })),
}))

interface FakeZitadelOptions {
  tokenEndpoint?: (req: http.IncomingMessage, res: http.ServerResponse) => void
  registerEndpoint?: (req: http.IncomingMessage, res: http.ServerResponse) => void
}

interface CapturedRequestBodies {
  readonly register: string[]
  readonly catalog: string[]
}

function createFakeZitadel(options: FakeZitadelOptions = {}): Promise<{
  server: http.Server
  baseUrl: string
  requestBodies: CapturedRequestBodies
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    const requestBodies: CapturedRequestBodies = { register: [], catalog: [] }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")

      if (url.pathname === "/oauth/v2/token") {
        if (options.tokenEndpoint) {
          options.tokenEndpoint(req, res)
        } else {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(
            JSON.stringify({
              access_token: "fake-access-token",
              id_token: "fake-id-token",
              refresh_token: "fake-refresh-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          )
        }
        return
      }

      if (url.pathname === "/oauth/v2/keys") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ keys: [] }))
        return
      }

      if (url.pathname === "/desktop/auth/session") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({
          sessionToken: "fake-session-token",
          expiresAt: "2026-07-12T00:00:00Z",
        }))
        return
      }

      if (url.pathname === "/apiweave.v1.DeviceService/RegisterDevice") {
        if (options.registerEndpoint) {
          options.registerEndpoint(req, res)
        } else {
          requestBodies.register.push(await readRequestBody(req))
          res.writeHead(200, { "content-type": "application/json" })
          res.end(
            JSON.stringify({
              id: "device-123",
              publicKey: Buffer.from("test-public-key").toString("base64"),
              label: "Test Device",
              clientVersion: "1.0.0",
              createdAt: "2026-07-11T00:00:00Z",
            }),
          )
        }
        return
      }

      if (url.pathname === "/apiweave.v1.DeviceService/ListSyncWorkspaces") {
        requestBodies.catalog.push(await readRequestBody(req))
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({
          workspaces: [{
            workspaceId: "cloud-workspace-123",
            workspaceName: "Personal",
            teamId: "",
            teamName: "",
            isPersonal: true,
            effectiveRole: "SYNC_WORKSPACE_ROLE_ADMIN",
            capabilities: { canPull: true, canPush: true, canResolveConflicts: true },
          }],
        }))
        return
      }

      res.writeHead(404).end("Not found")
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number }
      const baseUrl = `http://127.0.0.1:${address.port}`
      resolve({
        server,
        baseUrl,
        requestBodies,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

describe("cloud-link — happy path", () => {
  let tempDir: string
  let keyfilePath: string
  let fakeZitadel: Awaited<ReturnType<typeof createFakeZitadel>>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "apiweave-cloud-link-"))
    keyfilePath = join(tempDir, "secrets.keyfile.json")
    createKeyfile(keyfilePath)
    fakeZitadel = await createFakeZitadel()
    mockOpenExternal.mockClear()
  })

  afterEach(async () => {
    cancelDeviceLink()
    await fakeZitadel.close()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("completes the full link flow: browser → callback → exchange → register → encrypt", async () => {
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    // Start the link flow (don't await yet).
    const linkPromise = startDeviceLink(config)

    // Wait for the browser to be opened.
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    // Extract the callback URL from the authorize URL.
    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    expect(authorizeUrl).toContain("/oauth/v2/authorize")
    expect(authorizeUrl).toContain("client_id=test-client-id")
    expect(authorizeUrl).toContain("code_challenge_method=S256")
    expect(authorizeUrl).toContain("offline_access")

    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(state).toBeTruthy()

    // Simulate the OAuth callback.
    const callbackUrl = `${redirectUri}?code=test-auth-code&state=${state}`
    await fetch(callbackUrl)

    // Wait for the link to complete.
    const result = await linkPromise

    // Verify the result.
    expect(result.device.deviceId).toBe("device-123")
    expect(result.device.label).toBe("Test Device")
    expect(result.accessToken).toBe("fake-session-token")
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]).toMatchObject({
      workspaceId: "cloud-workspace-123",
      workspaceName: "Personal",
      isPersonal: true,
    })
    expect(JSON.parse(fakeZitadel.requestBodies.register[0] ?? "null")).toEqual({
      publicKey: "AQIDBA==",
      label: "Test Device",
      clientVersion: "1.0.0",
    })
    expect(fakeZitadel.requestBodies.catalog).toEqual(["{}"])
    expect(result.encryptedRefreshToken).toBeDefined()
    expect(result.wrappedDek).toBeDefined()
    expect(result.encryptedRefreshToken.algorithm).toBe("aes-256-gcm")

    // Verify the refresh token can be decrypted.
    const { readKeyfile } = await import("../../../core/secrets/keyfile")
    const keyfile = readKeyfile(keyfilePath)
    const dek = unwrapDek(result.wrappedDek, keyfile.masterKek)
    const decrypted = decrypt(result.encryptedRefreshToken, dek)
    expect(decrypted).toBe("fake-refresh-token")
  })

  it("encrypts the refresh token with the existing keyfile (no new key material)", async () => {
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")

    await fetch(`${redirectUri}?code=test-code&state=${state}`)
    const result = await linkPromise

    // Verify encryption uses the existing keyfile.
    const { readKeyfile } = await import("../../../core/secrets/keyfile")
    const keyfile = readKeyfile(keyfilePath)
    const dek = unwrapDek(result.wrappedDek, keyfile.masterKek)
    const decrypted = decrypt(result.encryptedRefreshToken, dek)
    expect(decrypted).toBe("fake-refresh-token")
  })
})

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

describe("cloud-link — negative cases", () => {
  let tempDir: string
  let keyfilePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "apiweave-cloud-link-"))
    keyfilePath = join(tempDir, "secrets.keyfile.json")
    createKeyfile(keyfilePath)
    mockOpenExternal.mockClear()
  })

  afterEach(() => {
    cancelDeviceLink()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("rejects wrong state (CSRF protection)", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")

    // Send callback with wrong state and wait for linkPromise to reject.
    const fetchPromise = fetch(`${redirectUri}?code=test-code&state=wrong-state`)
    await expect(linkPromise).rejects.toThrow(ErrLinkStateMismatch)
    await fetchPromise // Ensure fetch completes.

    await fakeZitadel.close()
  })

  it("rejects OAuth error response", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")

    const fetchPromise = fetch(`${redirectUri}?error=access_denied&state=${state}`)
    await expect(linkPromise).rejects.toThrow(ErrLinkBadCallback)
    await fetchPromise

    await fakeZitadel.close()
  })

  it("rejects token exchange failure", async () => {
    const fakeZitadel = await createFakeZitadel({
      tokenEndpoint: (req, res) => {
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "invalid_grant" }))
      },
    })

    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")

    await fetch(`${redirectUri}?code=expired-code&state=${state}`)

    await expect(linkPromise).rejects.toThrow(ErrLinkExchangeFailed)
    await fakeZitadel.close()
  })

  it("rejects device registration failure (revoked device)", async () => {
    const fakeZitadel = await createFakeZitadel({
      registerEndpoint: (req, res) => {
        res.writeHead(403, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "device revoked" }))
      },
    })

    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")

    await fetch(`${redirectUri}?code=test-code&state=${state}`)

    await expect(linkPromise).rejects.toThrow(ErrLinkExchangeFailed)
    await fakeZitadel.close()
  })

  it("times out after 5 minutes (configurable)", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
      timeoutMs: 100, // 100ms for fast test
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    // Don't send callback — let it timeout.
    await expect(linkPromise).rejects.toThrow(ErrLinkTimeout)
    await fakeZitadel.close()
  })

  it("cancelDeviceLink promptly rejects the active link", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    // Cancel immediately.
    cancelDeviceLink()

    await expect(linkPromise).rejects.toThrow(ErrLinkCancelled)
    expect(() => cancelDeviceLink()).not.toThrow()

    await fakeZitadel.close()
  })

  it("rejects a concurrent link attempt deterministically", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    await expect(startDeviceLink(config)).rejects.toThrow(ErrLinkBusy)
    cancelDeviceLink()
    await expect(linkPromise).rejects.toThrow(ErrLinkCancelled)
    await fakeZitadel.close()
  })
})

describe("cloud-link — restart persistence", () => {
  let tempDir: string
  let keyfilePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "apiweave-cloud-link-"))
    keyfilePath = join(tempDir, "secrets.keyfile.json")
    createKeyfile(keyfilePath)
    mockOpenExternal.mockClear()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("encrypted refresh token survives process restart", async () => {
    const fakeZitadel = await createFakeZitadel()
    const config: DeviceLinkConfig = {
      zitadelIssuer: fakeZitadel.baseUrl,
      desktopClientId: "test-client-id",
      apiBaseUrl: fakeZitadel.baseUrl,
      keyfilePath,
      deviceLabel: "Test Device",
      devicePublicKey: new Uint8Array([1, 2, 3, 4]),
      clientVersion: "1.0.0",
    }

    // First link.
    const linkPromise = startDeviceLink(config)
    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled(), { timeout: 5000 })

    const authorizeUrl = mockOpenExternal.mock.calls[0]?.[0] as string
    const url = new URL(authorizeUrl)
    const redirectUri = url.searchParams.get("redirect_uri")
    const state = url.searchParams.get("state")

    await fetch(`${redirectUri}?code=test-code&state=${state}`)
    const result = await linkPromise

    // Simulate process restart: re-read the keyfile and decrypt.
    const { readKeyfile } = await import("../../../core/secrets/keyfile")
    const keyfile = readKeyfile(keyfilePath)
    const dek = unwrapDek(result.wrappedDek, keyfile.masterKek)
    const decrypted = decrypt(result.encryptedRefreshToken, dek)

    expect(decrypted).toBe("fake-refresh-token")

    await fakeZitadel.close()
  })
})
