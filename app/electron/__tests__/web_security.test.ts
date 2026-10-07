import { describe, expect, it, vi } from "vitest"
import type { Session } from "electron"
import { CONTENT_SECURITY_POLICY, isAppUrl, isPermissionGranted, restrictPermissions } from "../web_security"

describe("isAppUrl", () => {
  it("accepts the renderer's own document", () => {
    expect(isAppUrl("app://local/")).toBe(true)
    expect(isAppUrl("app://local/index.html#/workflows")).toBe(true)
  })

  it("rejects every other URL, including the ones whose origin Node serialises as null", () => {
    // `new URL(x).origin` is "null" for all of these and for app://local alike,
    // which is exactly the comparison this replaced.
    for (const url of ["file:///etc/passwd", "data:text/html,hi", "javascript:alert(1)", "app://evil/", "about:srcdoc"]) {
      expect(isAppUrl(url)).toBe(false)
    }
    expect(isAppUrl("https://example.com")).toBe(false)
    expect(isAppUrl("not a url")).toBe(false)
  })
})

describe("permissions", () => {
  it("grants clipboard access to the app document only", () => {
    expect(isPermissionGranted("clipboard-sanitized-write", "app://local/")).toBe(true)
    expect(isPermissionGranted("clipboard-read", "app://local")).toBe(true)
    expect(isPermissionGranted("clipboard-read", "about:srcdoc")).toBe(false)
    expect(isPermissionGranted("clipboard-read", "https://example.com")).toBe(false)
  })

  it("denies everything else, even to the app document", () => {
    for (const permission of ["media", "geolocation", "notifications", "openExternal", "fullscreen", "hid", "serial"]) {
      expect(isPermissionGranted(permission, "app://local/")).toBe(false)
    }
  })

  it("installs both handlers on the session", () => {
    const setPermissionRequestHandler = vi.fn()
    const setPermissionCheckHandler = vi.fn()
    restrictPermissions({ setPermissionRequestHandler, setPermissionCheckHandler } as unknown as Session)

    const request = setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details: { requestingUrl: string },
    ) => void
    const callback = vi.fn()
    request(null, "media", callback, { requestingUrl: "app://local/" })
    request(null, "clipboard-sanitized-write", callback, { requestingUrl: "app://local/" })
    expect(callback.mock.calls).toEqual([[false], [true]])

    const check = setPermissionCheckHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      origin: string,
    ) => boolean
    expect(check(null, "clipboard-read", "app://local")).toBe(true)
    expect(check(null, "geolocation", "app://local")).toBe(false)
  })
})

describe("CONTENT_SECURITY_POLICY", () => {
  it("is a full policy, not just scripts and workers", () => {
    for (const directive of ["default-src", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      expect(CONTENT_SECURITY_POLICY).toContain(directive)
    }
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'")
  })
})
