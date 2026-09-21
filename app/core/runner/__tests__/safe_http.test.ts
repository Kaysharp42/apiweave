import { describe, expect, it } from "vitest"
import { SafeHttp, SafeUrlError, MAX_REDIRECT_HOPS } from "../safe_http"
import type { RequestInit, Response } from "undici"

const http = new SafeHttp()

describe("SafeHttp.isSafeUrl / validateUrl (pure)", () => {
  it("allows http and https", () => {
    expect(http.isSafeUrl("http://example.com")).toBe(true)
    expect(http.isSafeUrl("https://example.com/path?q=1")).toBe(true)
  })

  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "data:text/plain,hello",
    "javascript:alert(1)",
    "://missing-scheme",
    "",
  ])("rejects unsupported/broken schemes: %s", (url) => {
    expect(http.isSafeUrl(url)).toBe(false)
  })

  // A desktop user agent sends what the user authored. Every address below is
  // an ordinary target here; none of them is the client's business to refuse.
  it.each([
    "http://127.0.0.1:9999/x",
    "http://[::1]:9999/x",
    "http://localhost:8080/api",
    "http://host.docker.internal:5000/api",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://[fc00::1]",
    "http://169.254.169.254/latest/meta-data",
    "http://8.8.8.8",
  ])("allows any host the user pointed at: %s", (url) => {
    expect(http.isSafeUrl(url)).toBe(true)
  })

  it("validateUrl throws SafeUrlError for a non-http(s) URL, returns void for allowed", () => {
    expect(() => http.validateUrl("file:///etc/passwd")).toThrow(SafeUrlError)
    expect(() => http.validateUrl("http://example.com")).not.toThrow()
  })
})

describe("SafeHttp.checkRedirectAllowed", () => {
  it("absolute next URL re-validated against the scheme rule", () => {
    expect(http.checkRedirectAllowed("http://example.com/a", "http://example.com/b")).toBe(true)
    expect(http.checkRedirectAllowed("http://example.com/a", "file:///etc/passwd")).toBe(false)
    expect(http.checkRedirectAllowed("http://example.com/a", "")).toBe(false)
  })

  it("relative redirect resolved against current URL inherits the current host", () => {
    expect(http.checkRedirectAllowed("http://example.com/a", "/b")).toBe(true)
    expect(http.checkRedirectAllowed("http://example.com/a", "//other.com/path")).toBe(true)
    expect(http.checkRedirectAllowed("http://example.com/a", "//10.0.0.1/path")).toBe(true)
  })
})

describe("SafeHttp.safeFetch (no real network)", () => {
  it("happy path: original URL/hostname reaches the fetch impl untouched", async () => {
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      capturedUrl = url
      capturedInit = init
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    const res = await client.safeFetch("https://example.com/")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
    expect(capturedUrl).toBe("https://example.com/")
    // No dispatcher override unless the caller opted out of TLS verification,
    // so requests ride undici's pooled global agent.
    expect(capturedInit!.dispatcher).toBeUndefined()
  })

  it("rejectUnauthorized=false installs a dispatcher for the self-signed opt-out", async () => {
    let capturedInit: RequestInit | undefined
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      capturedInit = init
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    await client.safeFetch("https://self-signed.test/", {}, { rejectUnauthorized: false })
    expect(capturedInit!.dispatcher).toBeDefined()
  })

  it("redirect to a non-http(s) target is refused mid-chain", async () => {
    let calls = 0
    const fetchImpl = async (): Promise<Response> => {
      calls += 1
      if (calls === 1) {
        return new Response("", { status: 302, headers: { location: "file:///etc/passwd" } }) as unknown as Response
      }
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    await expect(client.safeFetch("https://example.com/")).rejects.toBeInstanceOf(SafeUrlError)
    expect(calls).toBe(1)
  })

  it("follows a redirect to a LAN host", async () => {
    const seen: string[] = []
    const fetchImpl = async (url: string): Promise<Response> => {
      seen.push(url)
      if (seen.length === 1) {
        return new Response("", { status: 302, headers: { location: "http://192.168.1.10/api" } }) as unknown as Response
      }
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    await expect(client.safeFetch("https://example.com/")).resolves.toMatchObject({ status: 200 })
    expect(seen).toEqual(["https://example.com/", "http://192.168.1.10/api"])
  })

  it("too many redirects raises SafeUrlError", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response("", { status: 302, headers: { location: "https://example.com/loop" } }) as unknown as Response
    const client = new SafeHttp({ fetchImpl: fetchImpl as never, maxRedirectHops: 2 })
    await expect(client.safeFetch("https://example.com/")).rejects.toThrow(/Too many redirects/)
  })

  it("honors the caller's abort signal instead of discarding it", async () => {
    const controller = new AbortController()
    controller.abort()
    let seenSignal: AbortSignal | undefined
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      seenSignal = init.signal ?? undefined
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    await expect(client.safeFetch("https://example.com/", { signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(seenSignal?.aborted).toBe(true)
  })

  it("timeout signal stays live after the response returns (covers body read)", async () => {
    let captured: AbortSignal | undefined
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      captured = init.signal ?? undefined
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ timeoutMs: 50, fetchImpl: fetchImpl as never })
    await client.safeFetch("https://example.com/")
    // The old code cleared the timer on return, leaving no way to abort a slow
    // body. The composed timeout signal must still be un-aborted-but-armed here.
    expect(captured).toBeDefined()
    expect(captured!.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 80))
    expect(captured!.aborted).toBe(true)
  })

  it("exports MAX_REDIRECT_HOPS default 5", () => {
    expect(MAX_REDIRECT_HOPS).toBe(5)
  })
})
