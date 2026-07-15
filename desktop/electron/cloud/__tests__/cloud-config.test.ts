import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DESKTOP_CONFIG_PATH,
  ErrCloudConfigInvalid,
  ErrCloudConfigUnavailable,
  fetchDesktopCloudConfig,
  parseDesktopCloudConfig,
} from "../cloud-config"

const VALID_CONFIG = {
  version: 1,
  webBaseUrl: "https://apiweave.kaysharp.com",
  apiBaseUrl: "https://apiweave-api.kaysharp.com",
  oidcIssuer: "https://apiweave-zitadel.kaysharp.com",
  desktopClientId: "desktop-client-id",
  minimumDesktopVersion: "0.1.0",
  syncProtocolVersions: [1, 2],
} as const

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("desktop cloud configuration", () => {
  it("validates and normalizes a version 1 configuration", () => {
    const config = parseDesktopCloudConfig({
      ...VALID_CONFIG,
      webBaseUrl: `${VALID_CONFIG.webBaseUrl}/`,
      apiBaseUrl: `${VALID_CONFIG.apiBaseUrl}/`,
      oidcIssuer: `${VALID_CONFIG.oidcIssuer}/`,
    }, `${VALID_CONFIG.webBaseUrl}/`)

    expect(config).toEqual(VALID_CONFIG)
  })

  it("allows HTTP only for explicit loopback development hosts", () => {
    expect(parseDesktopCloudConfig({
      ...VALID_CONFIG,
      webBaseUrl: "http://127.0.0.1:3000",
      apiBaseUrl: "http://localhost:8080",
      oidcIssuer: "http://auth.localhost:8081",
    }, "http://127.0.0.1:3000")).toMatchObject({ version: 1 })

    expect(parseDesktopCloudConfig({
      ...VALID_CONFIG,
      webBaseUrl: "http://[::1]:3000",
      apiBaseUrl: "http://[::1]:8080",
      oidcIssuer: "http://[::1]:8081",
    }, "http://[::1]:3000")).toMatchObject({ version: 1 })

    expect(() => parseDesktopCloudConfig({
      ...VALID_CONFIG,
      apiBaseUrl: "http://api.example.com",
    }, VALID_CONFIG.webBaseUrl)).toThrow(ErrCloudConfigInvalid)
  })

  it("fails closed for malformed, mismatched, or unsupported configuration", () => {
    const cases: unknown[] = [
      { ...VALID_CONFIG, version: 2 },
      { ...VALID_CONFIG, desktopClientId: "client id" },
      { ...VALID_CONFIG, minimumDesktopVersion: "latest" },
      { ...VALID_CONFIG, syncProtocolVersions: [99] },
      { ...VALID_CONFIG, webBaseUrl: "https://redirected.example" },
      { ...VALID_CONFIG, apiBaseUrl: "https://user:secret@example.com" },
      { ...VALID_CONFIG, oidcIssuer: "https://example.com/oidc" },
    ]

    for (const value of cases) {
      expect(() => parseDesktopCloudConfig(value, VALID_CONFIG.webBaseUrl)).toThrow(ErrCloudConfigInvalid)
    }
  })

  it("fetches only the trusted config path without following redirects", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(VALID_CONFIG), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    await expect(fetchDesktopCloudConfig(VALID_CONFIG.webBaseUrl, controller.signal)).resolves.toEqual(VALID_CONFIG)
    expect(fetchMock).toHaveBeenCalledWith(
      `${VALID_CONFIG.webBaseUrl}${DESKTOP_CONFIG_PATH}`,
      expect.objectContaining({ redirect: "error", signal: controller.signal }),
    )
  })

  it("returns safe typed errors for unavailable and malformed responses", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("secret-config-canary", { status: 503 }))
      .mockResolvedValueOnce(new Response("secret-config-canary", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const first = fetchDesktopCloudConfig(VALID_CONFIG.webBaseUrl, new AbortController().signal)
    await expect(first).rejects.toThrow(ErrCloudConfigUnavailable)
    await expect(first).rejects.not.toThrow(/secret-config-canary/)

    const second = fetchDesktopCloudConfig(VALID_CONFIG.webBaseUrl, new AbortController().signal)
    await expect(second).rejects.toThrow(ErrCloudConfigInvalid)
    await expect(second).rejects.not.toThrow(/secret-config-canary/)
  })
})
