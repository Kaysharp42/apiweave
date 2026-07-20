import { describe, expect, it } from "vitest"
import { SafeHttp, SafeUrlError, MAX_REDIRECT_HOPS } from "../safe_http"
import type { LookupAddress } from "node:dns"

const allowLoopback = new SafeHttp({ allowLoopback: true })
const strictHttp = new SafeHttp({ allowLoopback: false })

describe("SafeHttp.isSafeUrl / validateUrl (pure)", () => {
  it("allows http and https", () => {
    expect(allowLoopback.isSafeUrl("http://example.com")).toBe(true)
    expect(allowLoopback.isSafeUrl("https://example.com/path?q=1")).toBe(true)
  })

  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "data:text/plain,hello",
    "javascript:alert(1)",
    "://missing-scheme",
    "",
  ])("rejects unsupported/broken schemes: %s", (url) => {
    expect(allowLoopback.isSafeUrl(url)).toBe(false)
  })

  it("loopback allowed when allowLoopback=true", () => {
    expect(allowLoopback.isSafeUrl("http://127.0.0.1:9999/x")).toBe(true)
    expect(allowLoopback.isSafeUrl("http://[::1]:9999/x")).toBe(true)
  })

  it("loopback blocked when allowLoopback=false", () => {
    expect(strictHttp.isSafeUrl("http://127.0.0.1:9999/x")).toBe(false)
    expect(strictHttp.isSafeUrl("http://[::1]:9999/x")).toBe(false)
  })

  it.each([
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data", // AWS metadata
    "http://0.0.0.0",
    "http://224.0.0.1", // multicast
    "http://[fc00::1]", // IPv6 unique-local
    "http://[fe80::1]", // IPv6 link-local
    "http://[ff00::1]", // IPv6 multicast
    "http://[::]", // IPv6 unspecified
  ])("blocks the blocked address: %s", (url) => {
    expect(allowLoopback.isSafeUrl(url)).toBe(false)
  })

  it("public IP literal allowed (loopback mode)", () => {
    expect(allowLoopback.isSafeUrl("http://8.8.8.8")).toBe(true)
  })

  it("validateUrl throws SafeUrlError for blocked, returns void for allowed", () => {
    expect(() => allowLoopback.validateUrl("http://10.0.0.1")).toThrow(SafeUrlError)
    expect(() => allowLoopback.validateUrl("http://example.com")).not.toThrow()
  })
})

describe("SafeHttp.checkRedirectAllowed", () => {
  it("absolute next URL re-validated against pure rules", () => {
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "http://example.com/b")).toBe(true)
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "http://169.254.169.254/m")).toBe(false)
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "")).toBe(false)
  })

  it("relative redirect resolved against current URL inherits the current host", () => {
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "/b")).toBe(true)
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "//other.com/path")).toBe(true)
    expect(allowLoopback.checkRedirectAllowed("http://example.com/a", "//10.0.0.1/path")).toBe(false)
  })
})

describe("SafeHttp.resolveAndPinIp (DNS rebinding guard)", () => {
  it("throws when any resolved address is blocked", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]
    const http = new SafeHttp({ allowLoopback: true, dnsLookup })
    await expect(http.resolveAndPinIp("evil.test")).rejects.toBeInstanceOf(SafeUrlError)
  })

  it("returns the first resolved address when all are public", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ]
    const http = new SafeHttp({ allowLoopback: true, dnsLookup })
    await expect(http.resolveAndPinIp("good.test")).resolves.toBe("8.8.8.8")
  })

  it("allows loopback IP only when allowLoopback=true", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [{ address: "127.0.0.1", family: 4 }]
    await expect(new SafeHttp({ allowLoopback: true, dnsLookup }).resolveAndPinIp("localhost-relay")).resolves.toBe("127.0.0.1")
    await expect(new SafeHttp({ allowLoopback: false, dnsLookup }).resolveAndPinIp("localhost-relay")).rejects.toBeInstanceOf(SafeUrlError)
  })

  it("host.docker.internal skips pinning under allowLoopback", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [{ address: "10.0.0.1", family: 4 }]
    const http = new SafeHttp({ allowLoopback: true, dnsLookup })
    await expect(http.resolveAndPinIp("host.docker.internal")).resolves.toBeNull()
  })

  it("host.docker.internal not honored when allowLoopback=false", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [{ address: "10.0.0.1", family: 4 }]
    const http = new SafeHttp({ allowLoopback: false, dnsLookup })
    await expect(http.resolveAndPinIp("host.docker.internal")).rejects.toBeInstanceOf(SafeUrlError)
  })

  it("returns null when DNS lookup throws (unresolvable — not SSRF)", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => {
      throw new Error("ENOTFOUND")
    }
    const http = new SafeHttp({ allowLoopback: true, dnsLookup })
    await expect(http.resolveAndPinIp("nonexistent.test")).resolves.toBeNull()
  })

  it("throws when host is empty", async () => {
    const http = new SafeHttp({ allowLoopback: true })
    await expect(http.resolveAndPinIp("")).rejects.toBeInstanceOf(SafeUrlError)
  })

  it("assertHostResolvesSafe delegates to resolveAndPinIp", async () => {
    const dnsLookup = async (): Promise<LookupAddress[]> => [{ address: "169.254.169.254", family: 4 }]
    const http = new SafeHttp({ allowLoopback: true, dnsLookup })
    await expect(http.assertHostResolvesSafe("metadata.test")).rejects.toBeInstanceOf(SafeUrlError)
  })
})

describe("SafeHttp.safeFetch (no real network)", () => {
  it("rejects unsafe URL before touching fetch impl", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("fetch should not be called for blocked URL")
    }
    const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never })
    await expect(http.safeFetch("http://10.0.0.1/secret")).rejects.toBeInstanceOf(SafeUrlError)
  })

  it("happy path: pinned IP returned, response surfaced, Host header preserved", async () => {
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return new Response("ok", { status: 200 })
    }
    const dnsLookup = async (): Promise<LookupAddress[]> => [{ address: "93.184.216.34", family: 4 }]
    const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never, dnsLookup })
    const res = await http.safeFetch("https://example.com/")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
    expect(capturedUrl).toContain("93.184.216.34")
    const headers = new Headers(capturedInit!.headers)
    expect(headers.get("Host")).toBe("example.com")
  })

  it("redirect to blocked target is refused mid-chain", async () => {
    let calls = 0
    const fetchImpl = async (): Promise<Response> => {
      calls += 1
      if (calls === 1) return new Response("", { status: 302, headers: { location: "http://169.254.169.254/m" } })
      return new Response("ok", { status: 200 })
    }
    const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never,
      dnsLookup: async (host: string) => [{ address: host === "169.254.169.254" ? "169.254.169.254" : "93.184.216.34", family: 4 }] })
    await expect(http.safeFetch("https://example.com/")).rejects.toBeInstanceOf(SafeUrlError)
    expect(calls).toBe(1)
  })

  it("too many redirects raises SafeUrlError", async () => {
    const fetchImpl = async (): Promise<Response> => new Response("", { status: 302, headers: { location: "https://example.com/loop" } })
    const http = new SafeHttp({ allowLoopback: true, fetchImpl: fetchImpl as never, maxRedirectHops: 2,
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }] })
    await expect(http.safeFetch("https://example.com/")).rejects.toThrow(/Too many redirects/)
  })

  it("exports MAX_REDIRECT_HOPS default 5", () => {
    expect(MAX_REDIRECT_HOPS).toBe(5)
  })

  it("approved-domains allowlist narrows the accepted hosts", () => {
    const http = new SafeHttp({ allowLoopback: true, approvedDomains: ["api.github.com"] })
    expect(http.isSafeUrl("https://api.github.com/users/octocat")).toBe(true)
    expect(http.isSafeUrl("https://api.gitlab.com/users/octocat")).toBe(false)
  })
})
