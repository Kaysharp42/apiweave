import { describe, expect, it } from "vitest"
import { SafeHttp, SafeUrlError, MAX_REDIRECT_HOPS, describeNetworkError } from "../safe_http"
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
    await expect(client.safeFetch("http://example.com/")).resolves.toMatchObject({ status: 200 })
    expect(seen).toEqual(["http://example.com/", "http://192.168.1.10/api"])
  })

  it("reuses one insecure-TLS dispatcher instead of creating one per request", async () => {
    const dispatchers: unknown[] = []
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      dispatchers.push(init.dispatcher)
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    const client = new SafeHttp({ fetchImpl: fetchImpl as never })
    await client.safeFetch("https://self-signed.test/", {}, { rejectUnauthorized: false })
    await client.safeFetch("https://self-signed.test/", {}, { rejectUnauthorized: false })
    expect(dispatchers[0]).toBe(dispatchers[1])
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

describe("SafeHttp.safeFetch redirect semantics", () => {
  type Hop = { url: string; method: string; headers: Headers; body: unknown }

  /** A fetch that answers the first request with `status` → `location`, then 200. */
  function redirectOnce(status: number, location: string) {
    const hops: Hop[] = []
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      hops.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers as HeadersInit), body: init.body })
      if (hops.length === 1) return new Response("", { status, headers: { location } }) as unknown as Response
      return new Response("ok", { status: 200 }) as unknown as Response
    }
    return { hops, client: new SafeHttp({ fetchImpl: fetchImpl as never }) }
  }

  const credentialed = {
    method: "POST",
    headers: {
      Authorization: "Bearer t0ken",
      Cookie: "sid=abc",
      "Proxy-Authorization": "Basic eA==",
      "Content-Type": "application/json",
      "X-Trace": "1",
    },
    body: '{"a":1}',
  }

  it("strips Authorization, Cookie and Proxy-Authorization on a cross-origin redirect", async () => {
    const { hops, client } = redirectOnce(307, "https://other.example/next")
    await client.safeFetch("https://api.example/start", credentialed)
    const second = hops[1]!
    expect(second.url).toBe("https://other.example/next")
    expect(second.headers.get("authorization")).toBeNull()
    expect(second.headers.get("cookie")).toBeNull()
    expect(second.headers.get("proxy-authorization")).toBeNull()
    expect(second.headers.get("x-trace")).toBe("1")
  })

  it("keeps credentials on a same-origin redirect", async () => {
    const { hops, client } = redirectOnce(307, "/next")
    await client.safeFetch("https://api.example/start", credentialed)
    expect(hops[1]!.headers.get("authorization")).toBe("Bearer t0ken")
    expect(hops[1]!.headers.get("cookie")).toBe("sid=abc")
  })

  it("refuses an HTTPS to HTTP downgrade", async () => {
    const { hops, client } = redirectOnce(302, "http://api.example/plain")
    await expect(client.safeFetch("https://api.example/start", credentialed)).rejects.toThrow(
      "Refused redirect from HTTPS to HTTP: http://api.example/plain",
    )
    expect(hops).toHaveLength(1)
  })

  it.each([303, 301, 302])("%i turns a POST into a GET without a body or body headers", async (status) => {
    const { hops, client } = redirectOnce(status, "/next")
    await client.safeFetch("https://api.example/start", credentialed)
    const second = hops[1]!
    expect(second.method).toBe("GET")
    expect(second.body).toBeUndefined()
    expect(second.headers.get("content-type")).toBeNull()
    expect(second.headers.get("authorization")).toBe("Bearer t0ken")
  })

  it("303 turns a PUT into a GET; 301 keeps a PUT", async () => {
    const see = redirectOnce(303, "/next")
    await see.client.safeFetch("https://api.example/start", { ...credentialed, method: "PUT" })
    expect(see.hops[1]!.method).toBe("GET")
    const moved = redirectOnce(301, "/next")
    await moved.client.safeFetch("https://api.example/start", { ...credentialed, method: "PUT" })
    expect(moved.hops[1]!.method).toBe("PUT")
    expect(moved.hops[1]!.body).toBe('{"a":1}')
  })

  it.each([307, 308])("%i resends the method and body", async (status) => {
    const { hops, client } = redirectOnce(status, "/next")
    await client.safeFetch("https://api.example/start", credentialed)
    expect(hops[1]!.method).toBe("POST")
    expect(hops[1]!.body).toBe('{"a":1}')
    expect(hops[1]!.headers.get("content-type")).toBe("application/json")
  })
})

describe("SafeHttp.readBodyCapped", () => {
  it("keeps the first maxBytes of an oversized body and flags it, even with a Content-Length", async () => {
    const response = new Response("x".repeat(20), { headers: { "content-length": "20" } }) as unknown as Response
    const { bytes, truncated } = await http.readBodyCapped(response, 8)
    expect(truncated).toBe(true)
    expect(bytes.toString()).toBe("x".repeat(8))
  })

  it("returns the whole body untouched under the cap", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff])
    const { bytes, truncated } = await http.readBodyCapped(new Response(payload) as unknown as Response, 1024)
    expect(truncated).toBe(false)
    expect(bytes.equals(payload)).toBe(true)
  })
})

describe("describeNetworkError", () => {
  const withCause = (cause: Error) => new TypeError("fetch failed", { cause })
  const coded = (message: string, code: string) => Object.assign(new Error(message), { code })

  it.each([
    ["ENOTFOUND", "getaddrinfo ENOTFOUND nope.invalid", "Network error: could not resolve host nope.invalid (ENOTFOUND)"],
    ["EAI_AGAIN", "getaddrinfo EAI_AGAIN nope.invalid", "Network error: could not resolve host nope.invalid (EAI_AGAIN)"],
    ["ECONNRESET", "read ECONNRESET", "Network error: connection to nope.invalid was closed unexpectedly (ECONNRESET)"],
    ["CERT_HAS_EXPIRED", "certificate has expired", "Network error: TLS handshake with nope.invalid failed: certificate has expired (CERT_HAS_EXPIRED)"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate", "Network error: TLS handshake with nope.invalid failed: self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames", "Network error: TLS handshake with nope.invalid failed: Hostname/IP does not match certificate's altnames (ERR_TLS_CERT_ALTNAME_INVALID)"],
  ])("walks the cause chain to %s", (code, message, expected) => {
    expect(describeNetworkError(withCause(coded(message, code)), "https://nope.invalid/x")).toBe(expected)
  })

  it("returns null for an error with no system code", () => {
    expect(describeNetworkError(new Error("boom"), "https://nope.invalid/x")).toBeNull()
  })
})
